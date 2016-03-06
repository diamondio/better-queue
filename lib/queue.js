var uuid = require('node-uuid');
var util = require('util');
var EE   = require('events').EventEmitter;
var Ticket = require('./ticket');
var Worker = require('./worker');
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

  self.process = opts.process || function (task, cb) { cb(null, {}) };
  self.filter = opts.filter || function (input, cb) { cb(null, input) };
  self.priority = opts.priority || null;
  self.merge = opts.merge || function (oldTask, newTask, cb) { cb(null, newTask) };

  self.cancelIfRunning = (opts.cancelIfRunning === undefined ? true : !!opts.cancelIfRunning);
  self.autoResume = (opts.autoResume === undefined ? true : !!opts.autoResume);
  self.filo = opts.filo || false;
  self.batchSize = opts.batchSize || 1;
  self.concurrent = opts.concurrent || 1;
  self.processDelay = opts.processDelay || 0;
  self.maxTimeout = opts.maxTimeout || Infinity;
  self.idleTimeout = opts.idleTimeout || 0;
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
  self.use(opts.store || 'memory');
  self._store.connect(function () {
    if (self.autoResume) {
      self.resume();
    }
  })
}

util.inherits(Queue, EE);

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
    return self._store = store;
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
      .on('finish', function (result) { cb(null, result) })
      .on('failed', function (err) { cb(err) })
  }

  self.filter(input, function (err, task) {
    if (err || task === undefined || task === false || task === null) {
      return ticket.failed('input_rejected');
    }
    var taskId = task.id || uuid.v4();
    ticket.id = taskId;
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
  var priority;
  var isNew = true;
  var putTask = function () {
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
  }
  var updateTask = function () {
    if (!self.priority) return putTask();
    self.priority(task, function (err, p) {
      if (err) return ticket.failed('failed_to_prioritize');
      priority = p;
      putTask();
    })
  }

  var worker = self._workers[taskId];
  if (self.cancelIfRunning && worker) {
    worker.cancel();
  }

  self._store.getTask(taskId, function (err, oldTask) {
    if (err) return ticket.failed('failed_to_get');

    // No task before
    if (oldTask === undefined) {
      return updateTask();
    }

    self.merge(oldTask, task, function (err, newTask) {
      if (err) return ticket.failed('failed_task_merge');
      if (newTask === undefined) return;
      task = newTask;
      isNew = false;
      updateTask();
    });
  })
}

Queue.prototype._emptied = function () {
  if (this._calledEmpty) return;
  this._calledEmpty = true;
  this.emit('empty');
}

Queue.prototype._drained = function () {
  this._emptied();
  if (this._calledDrain) return;
  this._calledDrain = true;
  this.emit('drain');
}

Queue.prototype._getNextBatch = function (cb) {
  this._store[this.filo ? 'takeLastN' : 'takeFirstN'](this.batchSize, cb)
}

Queue.prototype._processNext = function () {

  var self = this;
  self._saturated = (self._running >= self.concurrent);
  if (self._saturated) return;
  if (self._stopped) return;

  if (self.concurrent - self._running > 1) {
    // Continue processing until saturated
    setImmediate(function () {
      self._processNext();
    })
  }

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
        ticket.started();
        tickets[taskId] = ticket;
        delete self._tickets[taskId];
      }
    })

    self._startBatch(batch, tickets);
  });
}

Queue.prototype._startBatch = function (batch, tickets) {
  var self = this;
  var taskIds = Object.keys(batch);
  var timeout = null;
  var worker = new Worker({
    fn: self.process,
    batch: batch,
    single: (self.batchSize === 1)
  })
  if (self.maxTimeout < Infinity) {
    timeout = setTimeout(function () {
      worker.failed('task_timeout');
    }, self.maxTimeout);
  }
  worker.on('task_failed', function (id, msg) {
    var taskId = taskIds[id];
    self._retries[taskId] = self._retries[taskId] || 0;
    self._retries[taskId]++;
    if (self._retries[taskId] >= self.maxRetries) {
      if (tickets[taskId]) {
        // Mark as a failure
        tickets[taskId].failed(msg);
        delete tickets[taskId];
      }
      self.emit('task_failed', taskId, msg);
    } else {
      // Pop back onto queue and retry
      self.emit('task_retry', taskId, self._retries[taskId]);
      self._queueTask(taskId, batch[taskId], tickets[taskId]);
    }
  })
  worker.on('task_finish', function (id, result) {
    var taskId = taskIds[id];
    if (tickets[taskId]) {
      tickets[taskId].finish(result);
      delete tickets[taskId];
    }
    self.emit('task_finish', taskId, result);
  })
  worker.on('task_progress', function (id, completed, total) {
    var taskId = taskIds[id];
    if (tickets[taskId]) {
      tickets[taskId].progress(completed, total);
      delete tickets[taskId];
    }
    self.emit('task_progress', taskId, completed, total);
  })
  worker.on('progress', function (progress) {
    self.emit('batch_progress', progress);
  })
  worker.on('finish', function (result) {
    self.emit('batch_finish', result);
  })
  worker.on('failed', function (err) {
    self.emit('batch_failed', err);
  })
  worker.on('end', function () {
    self._running--;
    if (timeout) {
      clearTimeout(timeout);
    }
    taskIds.forEach(function (taskId) {
      delete self._workers[taskId];
    });
    if (self.idleTimeout) {
      setTimeout(function () {
        self._processNext();
      }, self.idleTimeout);
    } else {
      setImmediate(function () {
        self._processNext();
      })
    }
  })

  // Acquire lock on process
  self._running++;
  worker.start();

  taskIds.forEach(function (taskId) {
    self._workers[taskId] = worker || {};
  });
}

module.exports = Queue;
