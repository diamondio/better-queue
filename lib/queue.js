
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

  self.process = opts.process || function (task, cb) { cb(null, {}) };
  self.filter = opts.filter || function (input, cb) { cb(null, input) };
  self.priority = opts.priority || function (input, cb) { cb(null, 1) };
  self.merge = opts.merge || function (oldTask, newTask, cb) { cb(null, newTask) };
  self.cancelIfRunning = (opts.cancelIfRunning === undefined ? true : !!opts.cancelIfRunning);

  self.fifo = opts.fifo || false;
  self.batchSize = opts.batchSize || 1;
  self.concurrent = opts.concurrent || 1;
  self.idleTimeout = opts.idleTimeout || 0;
  self.taskTimeout = opts.taskTimeout || Infinity;
  self.maxRetries = opts.maxRetries || Infinity;

  // Statuses
  self.stopped = false;
  self.saturated = false;

  self._calledDrain = false;
  self._calledEmpty = false;
  self._running = 0;  // Active running tasks
  self._retries = {}; // Map of taskId => retries
  self._workers = {}; // Map of taskId => active job
  self._tickets = {}; // Map of taskId => tickets
  self._queue = [];   // Array of taskIds
  self._tasks = {};   // Map of taskId => task 

  // TODO: Hold queue (wait for some event; like reconnect)
  // TODO: Priority function
  // TODO: Load from persistent storage
}

Queue.prototype.resume = function (cb) {
  var self = this;
  self.stopped = false;
}

Queue.prototype.pause = function (cb) {
  this.stopped = true;
}

Queue.prototype.push = function (input, cb) {
  var self = this;
  var ticket = new Ticket();
  if (cb) {
    ticket
      .on('done', function (result) { cb(null, result) })
      .on('error', function (err) { cb(err) })
  }
  self.filter(input, function (err, task) {
    if (err || task === undefined || task === false || task === null) {
      return ticket.failed('input_rejected');
    }
    var taskId = task.id || uuid.v4();
    ticket.accept();
    self._updateQueue(taskId, task, function (err) {
      if (err) return ticket.failed(err.message || 'failed_to_queue');
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


Queue.prototype._getTask = function (taskId, cb) {
  return cb(null, this._tasks[taskId]);
}

Queue.prototype._putTask = function (taskId, task, cb) {
  this._tasks[taskId] = task;
  cb();
}

Queue.prototype._updateTask = function (taskId, task, isNew, cb) {
  var self = this;
  self.priority(task, function (err, priority) {
    if (err) return cb({ message: 'failed_to_prioritize' });
    if (isNew) {
      self._calledDrain = false;
      self._calledEmpty = false;
      self._queue.push(taskId);
    }
    self._putTask(taskId, task, cb)
  })
}

Queue.prototype._updateQueue = function (taskId, task, cb) {
  var self = this;
  var worker = self._workers[taskId];
  if (self.cancelIfRunning && worker) {
    if (typeof worker.cancel === 'function') {
      worker.cancel();
    }
    if (typeof worker.abort === 'function') {
      worker.abort();
    }
  }

  self._getTask(taskId, function (err, oldTask) {
    if (err) return cb({ message: 'failed_to_get' });

    // No task before
    if (oldTask === undefined) {
      return self._updateTask(taskId, task, true, cb);
    }

    self.merge(oldTask, task, function (err, newTask) {
      if (err) return cb({ message: 'failed_task_merge' });
      if (newTask === undefined) return cb();
      self._updateTask(taskId, newTask, false, cb);
    });
  })
}

Queue.prototype._emptied = function () {
  if (this._calledEmpty) return;
  if (typeof this.empty === 'function') {
    this._calledEmpty = true;
    this.empty();
  }
}

Queue.prototype._drained = function () {
  this._emptied();
  if (this._calledDrain) return;
  if (typeof this.drain === 'function') {
    this._calledDrain = true;
    this.drain();
  }
}

Queue.prototype._processNext = function () {
  var self = this;
  self.saturated = (self._running >= self.concurrent);
  if (!self._queue.length && !self._running) {
    return self._drained();
  }
  if (!self._queue.length) {
    return self._emptied();
  }
  if (self.saturated) return;

  // Acquire lock on process
  self._running++;

  // Fetch next batch
  var batch = [];
  var tickets = {};
  while (self._queue.length && batch.length < self.batchSize) {
    var taskId = self._queue[self.fifo ? 'pop' : 'shift']();
    var task = self._tasks[taskId];
    if (task === undefined) continue;
    batch.push(task);
    tickets[taskId] = self._tickets[taskId];
    tickets[taskId].started(task.total);
    delete self._tasks[taskId];
    delete self._tickets[taskId];
  }

  // Didn't get anything in the batch after all.
  if (!batch.length) {
    self._running--;
    return;
  }

  setImmediate(function () {
    // startTask guarantees _running-- when it's done
    self._startTask(batch, tickets);
  })
  if (self._queue.length) {
    setImmediate(function () {
      self._processNext();
    })
  }
}

Queue.prototype._startTask = function (batch, tickets) {
  var self = this;
  var context = {
    succeeded: 0,
    failed: 0,
    finished: 0,
    progress: function (taskId, current) {
      if (tickets[taskId]) {
        tickets[taskId].progress(current);
      }
    }
  };

  var failedTask = function (taskId, msg) {
    context.failed++;
    context.finished++;
    self._retries[taskId] = self._retries[taskId] || 0;
    if (self._retries[taskId] > self.maxRetries) {
      if (tickets[taskId]) {
        // Mark as a failure
        tickets[taskId].failed(msg);
        delete tickets[taskId];
      }
    } else {
      // Pop back onto queue and retry
      self._queue.push(taskId);
    }
    setTimeout(function () {
      self._processNext();
    }, self.idleTimeout);
  }
  var finishedTask = function (taskId, result) {
    context.succeeded++;
    context.finished++;
    if (tickets[taskId]) {
      tickets[taskId].finish(result);
      delete tickets[taskId];
    }
    setTimeout(function () {
      self._processNext();
    }, self.idleTimeout);
  }

  var worker = self.process.call(context,
    (self.batchSize === 1 ? batch[0] : batch),
    function (err, result) {
      self._running--;
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
  Object.keys(tickets).forEach(function (taskId) {
    self._workers[taskId] = worker || {};
  });
}

module.exports = Queue;
