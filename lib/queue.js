
var uuid = require('node-uuid');
var Ticket = require('./ticket');
var Tickets = require('./tickets');

function Queue(process, opts) {
  var self = this;
  opts = opts || {};
  if (typeof process === 'object') {
    opts = process || {};
  }
  if (typeof process === 'function') {
    opts.process = process;
  }
  if (!opts.process) {
    throw new Error("Queue has no process function.");
  }

  opts = opts || {};
  
  self.empty = opts.empty || function(){};
  self.drain = opts.drain || function(){};
  self.accept = opts.accept || function (input, cb) { cb(null, input) };
  self.process = opts.process || function (task, cb) { cb(null, {}) };
  self.merge = opts.merge || function (task1, task2, cb) { cb(null, task2) };
  self.running = opts.running || function (worker, task, cb) { cb(null, task) };

  self.fifo = opts.fifo || false;
  self.batchSize = opts.batchSize || 1;
  self.concurrent = opts.concurrent || 1;
  self.idleTimeout = opts.idleTimeout || 0;
  self.taskTimeout = opts.taskTimeout || Infinity;
  self.maxRetries = opts.maxRetries || Infinity;

  // Statuses
  self.saturated = false;

  self._processes = 0; // Active running tasks
  self._queue = [];   // Array of taskIds
  self._tasks = {};   // Map of taskId => task 
  self._retries = {}; // Map of taskId => retries
  self._workers = {}; // Map of taskId => active job
  self._tickets = {}; // Map of taskId => tickets

  // TODO: Hold queue (wait for some event; like reconnect)
  // TODO: Load from persistent storage
}

Queue.prototype.push = function (input, cb) {
  var self = this;
  var ticket = new Ticket();
  if (cb) {
    ticket
      .on('done', function (result) { cb(null, result) })
      .on('error', function (err) { cb(err) })
  }
  self.accept(input, function (err, task) {
    if (err || task === undefined || task === false || task === null) {
      return ticket.failed('input_rejected');
    }
    var taskId = task.id || uuid.v4();
    ticket.accept();
    self._updateQueue(taskId, task, function (err) {
      if (err) return ticket.failed('failed_to_queue');
      if (!self._tickets[taskId]) {
        self._tickets[taskId] = new Tickets();
      }
      self._tickets[taskId].push(ticket);
      ticket.queued();
      setImmediate(function () {
        self._processNext();
      })
    });
  })
  return ticket;
}

Queue.prototype._updateQueue = function (taskId, task, cb) {
  var self = this;
  if (self._workers[taskId]) {
    self.running(self._workers[taskId], task, function (err, task) {
      if (err) return cb(err);
      if (task === undefined || task === false || task === null) return cb();
      self._enqueueTask(taskId, task, cb);
    })
  } else {
    self._enqueueTask(taskId, task, cb);
  }
}

Queue.prototype._enqueueTask = function (taskId, task, cb) {
  var self = this;
  // Check if already in queue
  if (self._tasks[taskId] !== undefined) {
    self.merge(self._tasks[taskId], task, function (err, newTask) {
      if (err) return cb({ message: 'failed_task_merge' });
      if (newTask !== undefined) {
        self._tasks[taskId] = newTask;
      }
      cb();
    });
  } else {
    self._tasks[taskId] = task;
    self._queue.push(taskId);
    cb();
  }
}

Queue.prototype._emptied = function () {
  if (typeof this.empty === 'function') {
    this.empty();
  }
}

Queue.prototype._drained = function () {
  if (typeof this.drain === 'function') {
    this.drain();
  }
}

Queue.prototype._processNext = function () {
  var self = this;
  self.saturated = (self._processes >= self.concurrent);
  if (!self._queue.length && !self._processes) {
    return self._drained();
  }
  if (!self._queue.length) {
    return self._emptied();
  }

  // Acquire lock on process
  self._processes++;

  // Fetch next batch
  var batch = [];
  while (self._queue.length && batch.length < self.batchSize) {
    var taskId = self._queue[self.fifo ? 'pop' : 'shift']();
    var task = self._tasks[taskId];
    batch.push({
      id: taskId,
      task: self._tasks[taskId],
      ticket: self._tickets[taskId]
    });
    delete self._tasks[taskId];
    delete self._tickets[taskId];
  }

  // Didn't get anything in the batch after all.
  if (!batch.length) {
    self._processes--;
    return;
  }
  
  setImmediate(function () {
    self._startTask(batch);
  })
  if (self._queue.length) {
    setImmediate(function () {
      self._processNext();
    })
  }
}

Queue.prototype._startTask = function (batch) {
  var self = this;
  var task = null;
  var tickets = {};
  var failedTask = function (taskId, msg) {
    // TODO: Retry here
    if (tickets[taskId]) {
      tickets[taskId].failed(msg);
      delete tickets[taskId];
    }
    setTimeout(function () {
      self._processNext();
    }, self.idleTimeout);
  }
  var finishedTask = function (taskId, result) {
    if (tickets[taskId]) {
      tickets[taskId].finish(result);
      delete tickets[taskId];
    }
    setTimeout(function () {
      self._processNext();
    }, self.idleTimeout);
  }
  batch.forEach(function (item) {
    if (item.ticket) {
      tickets[item.id] = item.ticket;
      tickets[item.id].started(item.task.total);
    }
  });
  if (self.batchSize === 1) {
    task = batch[0].task;
  } else {
    var tasks = {};
    batch.forEach(function (item) {
      tasks[item.id] = item.task;
    });
    task = {
      tasks: tasks,
      finish: finishedTask,
      failed: failedTask,
      progress: function (taskId, current) {
        if (tickets[taskId]) {
          tickets[taskId].progress(current);
        }
      },
    }
  }
  var worker = self.process(task, function (err, result) {
    self._processes--;
    if (err) {
      for (var taskId in tickets) {
        failedTask(taskId, err.message || err);
        delete self._workers[taskId];
      }
    } else {
      for (var taskId in tickets) {
        finishedTask(taskId, result);
        delete self._workers[taskId];
      }
    }
  });
  batch.forEach(function (item) {
    self._workers[item.id] = worker || {};
  });
}

module.exports = Queue;
