var async = require('async');
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
  self.filo = opts.filo || false;
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
}

Queue.prototype._getWorkers = function () {
  var self = this;
  var workers = [];
  Object.keys(self._workers).forEach(function (taskId) {
    var worker = self._workers[taskId];
    if (worker && workers.indexOf(worker) === -1) {
      workers.push(worker);
    }
  })
  return workers;
}

Queue.prototype.resume = function () {
  this.stopped = false;
  this._getWorkers().forEach(function (worker) {
    if (typeof worker.resume === 'function') {
      worker.resume();
    }
  })
}

Queue.prototype.pause = function () {
  this.stopped = true;
  this._getWorkers().forEach(function (worker) {
    if (typeof worker.pause === 'function') {
      worker.pause();
    }
  })
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
    self._updateQueue(taskId, task, ticket);
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

Queue.prototype._getNextBatch = function (cb) {
  var self = this;
  var batch = {};
  if (self.filo) {
    taskIds = self._queue.splice(-self.batchSize).reverse();
  } else {
    taskIds = self._queue.splice(0, self.batchSize);
  }
  async.map(taskIds, function (taskId, cb) {
    self._getTask(taskId, function (err, task) {
      if (err || task === undefined) return cb();
      var ticket = self._tickets[taskId];
      ticket.started(task.total);
      delete self._tickets[taskId];
      batch[taskId] = {
        task: task,
        ticket: ticket
      }
      cb();
    })
  }, function () {
    cb(null, batch);
  });
}

Queue.prototype._reorderQueue = function (taskId, priority, ticket) {
  var self = this;
  ticket.queued();
  if (self._queue.indexOf(taskId) === -1) {
    self._queue.push(taskId);
  }
  setImmediate(function () {
    self._processNext();
  })
}

Queue.prototype._updateTask = function (taskId, task, ticket, isNew) {
  var self = this;
  
  if (!self._tickets[taskId]) {
    self._tickets[taskId] = new Tickets();
  }
  self._tickets[taskId].push(ticket);
  ticket.queued();

  self.priority(task, function (err, priority) {
    if (err) return ticket.failed('failed_to_prioritize');
    self._putTask(taskId, task, function (err) {
      if (err) return ticket.failed('failed_to_put_task');
      if (isNew) {
        self._calledDrain = false;
        self._calledEmpty = false;
      }
      self._reorderQueue(taskId, priority, ticket);
    })
  })
}

Queue.prototype._updateQueue = function (taskId, task, ticket) {
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
    if (err) return ticket.failed('failed_to_get');

    // No task before
    if (oldTask === undefined) {
      return self._updateTask(taskId, task, ticket, true);
    }

    self.merge(oldTask, task, function (err, newTask) {
      if (err) return ticket.failed('failed_task_merge');
      if (newTask === undefined) return;
      self._updateTask(taskId, newTask, ticket, false);
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
  if (self.saturated) return;

  // Fetch next batch
  self._getNextBatch(function (err, batch) {
    if (err || !batch) return;

    var isEmpty = !Object.keys(batch).length;

    if (isEmpty && !self._running) {
      return self._drained();
    }

    if (isEmpty) {
      return self._emptied();
    }

    self._startTask(batch);
  });

}

Queue.prototype._startTask = function (batch) {
  var self = this;
  var context = {
    succeeded: 0,
    failed: 0,
    finished: 0,
    progress: function (taskId, current) {
      if (batch[taskId].ticket) {
        batch[taskId].ticket.progress(current);
      }
    }
  };

  var failedTask = function (taskId, msg) {
    context.failed++;
    context.finished++;
    self._retries[taskId] = self._retries[taskId] || 0;
    if (self._retries[taskId] > self.maxRetries) {
      if (batch[taskId].ticket) {
        // Mark as a failure
        batch[taskId].ticket.failed(msg);
        delete batch[taskId].ticket;
      }
    } else {
      // Pop back onto queue and retry
      self._updateQueue(taskId, batch[taskId].task);
    }
    setTimeout(function () {
      self._processNext();
    }, self.idleTimeout);
  }
  var finishedTask = function (taskId, result) {
    context.succeeded++;
    context.finished++;
    if (batch[taskId].ticket) {
      batch[taskId].ticket.finish(result);
      delete batch[taskId].ticket;
    }
    setTimeout(function () {
      self._processNext();
    }, self.idleTimeout);
  }

  var task;
  if (self.batchSize === 1) {
    task = batch[Object.keys(batch)[0]].task
  } else {
    task = {};
    Object.keys(batch).forEach(function (taskId) {
      task[taskId] = batch[taskId].task
    })
  }

  // Acquire lock on process
  self._running++;
  var worker = self.process.call(context, task, function (err, result) {
      self._running--;
      if (err) {
        for (var taskId in batch) {
          failedTask(taskId, err.message || err);
          delete self._workers[taskId];
        }
      } else {
        for (var taskId in batch) {
          finishedTask(taskId, result);
          delete self._workers[taskId];
        }
      }
    });
  Object.keys(batch).forEach(function (taskId) {
    self._workers[taskId] = worker || {};
  });
}

module.exports = Queue;
