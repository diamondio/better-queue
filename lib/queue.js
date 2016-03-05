var async = require('async');
var uuid = require('node-uuid');
var Ticket = require('./ticket');
var Tickets = require('./tickets');
var MemoryStore = require('./stores/memory');

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
  self.autoResume = (opts.autoResume === undefined ? true : !!opts.autoResume);
  self.filo = opts.filo || false;
  self.batchSize = opts.batchSize || 1;
  self.concurrent = opts.concurrent || 1;
  self.processDelay = opts.processDelay || 0;
  self.idleTimeout = opts.idleTimeout || 0;
  self.taskTimeout = opts.taskTimeout || Infinity;
  self.maxRetries = opts.maxRetries || 0;

  // Statuses
  self._stopped = false;
  self._saturated = false;

  self._timeout = null;
  self._calledDrain = true;
  self._calledEmpty = true;
  self._running = 0;  // Active running tasks
  self._retries = {}; // Map of taskId => retries
  self._workers = {}; // Map of taskId => active job
  self._tickets = {}; // Map of taskId => tickets

  // Initialize Storage
  self.use(self.store || 'memory');
  self._store.connect(function () {
    if (self.autoResume) {
      self.resume();
    }
  })
}

Queue.prototype.use = function (store, opts) {
  var self = this;
  if (typeof store === 'string') {
    try {
      var Store = require('./stores/' + store)
      return self._store = new Store(opts);
    } catch (e) {}
  }
  if (typeof store === 'object' && typeof store.type === 'string') {
    try {
      var Store = require('./stores/' + store.type)
      return self._store = new Store(store);
    } catch (e) {}
  }
  if (typeof store === 'object' &&
    store.putTask &&
    store.getTask &&
    ((self.filo && store.takeLastN) ||
     (!self.filo && store.takeFirstN))) {
    self._store = store;
  }
  throw new Error('unknown_store');
}

Queue.prototype.resume = function () {
  var self = this;
  self._stopped = false;
  self._getWorkers().forEach(function (worker) {
    if (typeof worker.resume === 'function') {
      worker.resume();
    }
  })
  self._processNext();
}

Queue.prototype.pause = function () {
  this._stopped = true;
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
    self._queueTask(taskId, task, ticket);
  })
  return ticket;
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

Queue.prototype._queueTask = function (taskId, task, ticket) {
  var self = this;
  var updateTask = function (isNew) {
    self.priority(task, function (err, priority) {
      if (err) return ticket.failed('failed_to_prioritize');
      self._store.putTask(taskId, task, priority, function (err) {
        if (err) return ticket.failed('failed_to_put_task');

        if (!self._tickets[taskId]) {
          self._tickets[taskId] = new Tickets();
        }
        self._tickets[taskId].push(ticket);
        ticket.queued();

        if (isNew) {
          self._calledDrain = false;
          self._calledEmpty = false;
        }
        if (!self._timeout) {
          self._timeout = setTimeout(function () {
            self._timeout = null;
            self._processNext();
          }, self.processDelay)
        }
      })
    })
  }

  var worker = self._workers[taskId];
  if (self.cancelIfRunning && worker) {
    if (typeof worker.cancel === 'function') {
      worker.cancel();
    }
    if (typeof worker.abort === 'function') {
      worker.abort();
    }
  }

  self._store.getTask(taskId, function (err, oldTask) {
    if (err) return ticket.failed('failed_to_get');

    // No task before
    if (oldTask === undefined) {
      return updateTask(true);
    }

    self.merge(oldTask, task, function (err, newTask) {
      if (err) return ticket.failed('failed_task_merge');
      if (newTask === undefined) return;
      updateTask(false);
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

Queue.prototype._getNextBatch = function (cb) {
  this._store[this.filo ? 'takeLastN' : 'takeFirstN'](this.batchSize, cb)
}

Queue.prototype._processNext = function () {

  var self = this;
  self._saturated = (self._running >= self.concurrent);
  if (self._saturated) return;
  if (self._stopped) return;

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

    var tickets = {};
    Object.keys(batch).forEach(function (taskId) {
      var ticket = self._tickets[taskId];
      if (ticket) {
        ticket.started(batch[taskId].total);
        tickets[taskId] = ticket;
        delete self._tickets[taskId];
      }
    })

    self._startBatch(batch, tickets);

    // Continue processing until saturated
    setImmediate(function () {
      self._processNext();
    })
  });
}

Queue.prototype._startBatch = function (batch, tickets) {
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
      self._pushTask(taskId, batch[taskId], tickets[taskId]);
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

  var task = batch;
  if (self.batchSize === 1) {
    task = batch[Object.keys(batch)[0]]
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
