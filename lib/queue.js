
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

  self._processes = 0;
  self._queue = [];
  self._tasks = {}; // Map of taskId => task
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

Queue.prototype._processNext = function () {
  var self = this;
  if (!self._queue.length) return;
  if (self._processes >= self.concurrent) return;
  self._processes++;
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
  if (!batch.length) return;
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
      // TODO: Retry?
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
