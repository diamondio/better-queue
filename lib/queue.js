var uuid = require('node-uuid');
var util = require('util');
var EE   = require('events').EventEmitter;
var Ticket = require('./ticket');
var Worker = require('./worker');
var Tickets = require('./tickets');

var stores = {
  memory: require('./stores/memory'),
  sqlite: require('./stores/sqlite'),
}

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
  self.merge = opts.merge || function (oldTask, newTask, cb) { cb(null, newTask) };
  self.id = opts.id || false;
  self.priority = opts.priority || null;

  self.cancelIfRunning = (opts.cancelIfRunning === undefined ? true : !!opts.cancelIfRunning);
  self.autoResume = (opts.autoResume === undefined ? true : !!opts.autoResume);
  self.filo = opts.filo || false;
  self.batchSize = opts.batchSize || 1;
  self.batchDelay = opts.batchDelay || 0;
  self.afterProcessDelay = opts.afterProcessDelay || 0;
  self.concurrent = opts.concurrent || 1;
  self.maxTimeout = opts.maxTimeout || Infinity;
  self.maxRetries = opts.maxRetries || 0;
  self.storeMaxRetries = opts.storeMaxRetries || Infinity;
  self.storeRetryTimeout = opts.storeRetryTimeout || 1000;

  // Statuses
  self._queuedPeak = 0;
  self._queuedTime = {};
  self._processedTotalElapsed = 0;
  self._processedAverage = 0;
  self._processedTotal = 0;
  self._failedTotal = 0;
  self.length = 0;
  self._stopped = false;
  self._saturated = false;

  self._timeout = null;
  self._connected = false;
  self._storeRetries = 0;
  
  // Locks
  self._hasMore = false;
  self._isWriting = false;
  self._writeQueue = [];
  self._writing = {};
  self._tasksWaitingForConnect = [];

  self._calledDrain = true;
  self._calledEmpty = true;
  self._fetching = 0;
  self._running = 0;  // Active running tasks
  self._retries = {}; // Map of taskId => retries
  self._workers = {}; // Map of taskId => active job
  self._tickets = {}; // Map of taskId => tickets

  // Initialize Storage
  self.use(opts.store || 'memory');
  if (!self._store) {
    throw new Error('Queue cannot continue without a valid store.')
  }
}

util.inherits(Queue, EE);

Queue.prototype.destroy = function () {
  if (typeof this._store.close === 'function') {
    this._store.close();
  }
  var self = this;

  // Statuses
  self._hasMore = false;
  self._isWriting = false;
  self._writeQueue = [];
  self._writing = {};
  self._tasksWaitingForConnect = [];

  // Clear internals
  self._tickets = {};
  self._workers = {};
  self._fetching = 0;
  self._running = {};
  self._retries = {};
  self._calledEmpty = true;
  self._calledDrain = true;
  self._stopped = false;
  self._connected = false;
}

Queue.prototype.resetStats = function () {
  this._queuedPeak = 0;
  this._processedTotalElapsed = 0;
  this._processedAverage = 0;
  this._processedTotal = 0;
  this._failedTotal = 0;
}

Queue.prototype.getStats = function () {
  var successRate = this._processedTotal === 0 ? 0 : (1 - (this._failedTotal / this._processedTotal));
  return {
    successRate: successRate,
    peak: this._queuedPeak,
    average: this._processedAverage,
    total: this._processedTotal
  }
}

Queue.prototype.use = function (store, opts) {
  var self = this;
  if (typeof store === 'string' && stores[store]) {
    try {
      self._store = new stores[store](opts);
    } catch (e) { throw e }
  } else if (typeof store === 'object' && typeof store.type === 'string' && stores[store.type]) {
    try {
      self._store = new stores[store.type](store);
    } catch (e) { throw e }
  } else if (typeof store === 'object' &&
    store.putTask &&
    store.getTask &&
    ((self.filo && store.takeLastN) ||
     (!self.filo && store.takeFirstN))) {
    self._store = store;
  } else {
    throw new Error('unknown_store');
  }
  self._connected = false;
  self._tasksWaitingForConnect = [];
  self._connectToStore();
}

Queue.prototype._connectToStore = function () {
  var self = this;
  if (self._connected) return;
  if (self._storeRetries >= self.storeMaxRetries) {
    return self.emit('error', new Error('failed_connect_to_store'));
  }
  self._storeRetries++;
  self._store.connect(function (err, len) {
    if (err) return setTimeout(function () {
      self._connectToStore();
    }, self.storeRetryTimeout);
    if (len === undefined || len === null) throw new Error("store_not_returning_length");
    self.length = parseInt(len);
    if (isNaN(self.length)) throw new Error("length_is_not_a_number");
    self._connected = true;
    self._storeRetries = 0;
    if (!self._stopped && self.autoResume) {
      self.resume();
    }
    for (var i = 0; i < self._tasksWaitingForConnect.length; i++ ) {
      self.push(self._tasksWaitingForConnect[i].input, self._tasksWaitingForConnect[i].ticket);
    }
  })

}

Queue.prototype.resume = function () {
  var self = this;
  self._stopped = false;
  self._getWorkers().forEach(function (worker) {
    if (typeof worker.resume === 'function') {
      worker.resume();
    }
  })
  setTimeout(function () {
    self._processIfFull();
  }, 0)
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
  if (cb instanceof Ticket) {
    ticket = cb;
  } else if (cb) {
    ticket
      .on('finish', function (result) { cb(null, result) })
      .on('failed', function (err) { cb(err) })
  }

  if (!self._connected) {
    self._tasksWaitingForConnect.push({ input: input, ticket: ticket });
    return ticket;
  }

  self.filter(input, function (err, task) {
    if (err || task === undefined || task === false || task === null) {
      return ticket.failed('input_rejected');
    }
    var acceptTask = function (taskId) {
      setTimeout(function () {
        self._queueTask(taskId, task, ticket);
      }, 0)
    }
    if (typeof self.id === 'function') {
      self.id(task, function (err, id) {
        if (err) return ticket.failed('id_error');
        acceptTask(id);
      })
    } else if (typeof self.id === 'string' && typeof task === 'object') {
      acceptTask(task[self.id])
    } else {
      acceptTask();
    }
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

Queue.prototype._writeNextTask = function () {
  var self = this;
  if (self._isWriting) return;
  if (!self._writeQueue.length) return;
  self._isWriting = true;

  var taskId = self._writeQueue.shift();
  var finishedWrite = function () {
    self._isWriting = false;
    setImmediate(function () {
      self._writeNextTask();
    })
  }

  if (!self._writing[taskId]) {
    delete self._writing[taskId];
    return finishedWrite();
  }

  var task = self._writing[taskId].task;
  var priority = self._writing[taskId].priority;
  var isNew = self._writing[taskId].isNew;
  var writeId = self._writing[taskId].id;
  self._store.putTask(taskId, task, priority, function (err) {

    // Check if task has changed since put
    var tickets = self._writing[taskId].tickets;
    if (self._writing[taskId].id !== writeId) {
      self._writeQueue.unshift(taskId);
      return finishedWrite();
    }
    delete self._writing[taskId];
    
    // If something else has written to taskId, then wait.
    if (err) {
      tickets.failed('failed_to_put_task');
      return finishedWrite();
    }
    
    // Task is in the queue -- update stats
    self.length++;
    if (self._queuedPeak < self.length) {
      self._queuedPeak = self.length;
    }
    self._queuedTime[taskId] = new Date().getTime();

    // Notify the ticket
    self._tickets[taskId] = tickets;
    self.emit('task_queued', taskId, task);
    tickets.queued();

    // If it's a new task, make sure to call drain after.
    if (isNew) {
      self._calledDrain = false;
      self._calledEmpty = false;
    }

    // If already fetching, mark that there are additions to the queue
    if (self._fetching > 0) {
      self._hasMore = true;
    }

    // Finish writing
    finishedWrite();
    self._processIfFull();
  })
}

Queue.prototype._queueTask = function (taskId, newTask, ticket) {
  var self = this;
  var isUUID = false;
  if (!taskId) {
    taskId = uuid.v4();
    isUUID = true;
  }
  var priority;
  var oldTask = null;
  var putTask = function () {

    // Save ticket
    var tickets = (self._writing[taskId] && self._writing[taskId].tickets) || new Tickets();
    tickets.push(ticket);

    // Add to queue
    var alreadyQueued = !!self._writing[taskId];
    self._writing[taskId] = {
      id: uuid.v4(),
      isNew: !oldTask,
      task: newTask,
      priority: priority,
      tickets: tickets
    };
    if (!alreadyQueued) {
      self._writeQueue.push(taskId);
    }

    self._writeNextTask();
  }
  var updateTask = function () {
    ticket.accept();
    self.emit('task_accepted', taskId, newTask);

    if (!self.priority) return putTask();
    self.priority(newTask, function (err, p) {
      if (err) return ticket.failed('failed_to_prioritize');
      priority = p;
      putTask();
    })
  }
  var mergeTask = function () {
    if (!oldTask) return updateTask();
    self.merge(oldTask, newTask, function (err, mergedTask) {
      if (err) return ticket.failed('failed_task_merge');
      if (mergedTask === undefined) return;
      newTask = mergedTask;
      updateTask();
    })
  }

  if (isUUID) {
    return updateTask();
  }

  var worker = self._workers[taskId];
  if (self.cancelIfRunning && worker) {
    worker.cancel();
  }

  // Check if task is writing
  if (self._writing[taskId]) {
    oldTask = self._writing[taskId].task;
    return mergeTask();
  }

  // Check store for task
  self._store.getTask(taskId, function (err, savedTask) {
    if (err) return ticket.failed('failed_to_get');

    // Check if task is writing
    if (self._writing[taskId]) {
      oldTask = self._writing[taskId].task;
      return mergeTask();
    }

    // No task before
    if (savedTask === undefined) {
      return updateTask();
    }

    oldTask = savedTask;
    mergeTask();
  })
}

Queue.prototype._emptied = function () {
  if (this._calledEmpty) return;
  this._calledEmpty = true;
  this.emit('empty');
}

Queue.prototype._drained = function () {
  if (this._calledDrain) return;
  this._calledDrain = true;
  this.emit('drain');
}

Queue.prototype._getNextBatch = function (cb) {
  this._store[this.filo ? 'takeLastN' : 'takeFirstN'](this.batchSize, cb)
}

Queue.prototype._processIfFull = function () {
  var self = this;
  if (self.length >= self.batchSize) {
    if (self._timeout) {
      clearTimeout(self._timeout);
      self._timeout = null;
    }
    setImmediate(function () {
      self._processNext();
    })
  } else if (!self._timeout) {
    self._timeout = setTimeout(function () {
      self._timeout = null;
      self._processNext();
    }, self.batchDelay)
  }
}

Queue.prototype._processNext = function () {
  var self = this;
  if (!self._connected) return;
  if (self._stopped) return;
  
  self._saturated = (self._running + self._fetching >= self.concurrent);
  if (self._saturated) return;
  if (!self.length) {
    if (!self._hasMore) {
      self._emptied();
      if (!self._running) {
        self._drained();
      }
    }
    return;
  }

  // Fetch next batch
  // FIXME: There may still be things writing
  self._hasMore = false;
  self._fetching++;
  self._getNextBatch(function (err, batch) {
    self._fetching--;
    if (err || !batch) return;
    var batchSize = Object.keys(batch).length;
    var isEmpty = (batchSize === 0);

    if (self.length < batchSize) {
      self.length = batchSize;
    }
    self.length -= batchSize;

    if (!self._hasMore && isEmpty) {
      self._emptied();
      if (!self._running) {
        self._drained();
      }
      return;
    }

    // The write queue wasn't empty on fetch, so we should fetch more.
    if (self._hasMore && isEmpty) {
      return self._processIfFull()
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

    if (self.concurrent - self._running > 1) {
      // Continue processing until saturated
      self._processIfFull();
    }

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
  var updateStatsForEndedTask = function (taskId) {
    self._processedTotal++;
    var stats = {};
    if (!self._queuedTime[taskId]) return stats;

    var elapsed = (new Date().getTime() - self._queuedTime[taskId]);
    delete self._queuedTime[taskId];
    
    if (elapsed > 0) {
      stats.elapsed = elapsed;
      self._processedTotalElapsed += elapsed;
      self._processedAverage = self._processedTotalElapsed/self._processedTotal;
    }
    return stats;
  }

  if (self.maxTimeout < Infinity) {
    timeout = setTimeout(function () {
      worker.failedBatch('task_timeout');
    }, self.maxTimeout);
  }
  worker.on('task_failed', function (id, msg) {
    var taskId = taskIds[id];
    self._retries[taskId] = self._retries[taskId] || 0;
    self._retries[taskId]++;
    if (self._retries[taskId] >= self.maxRetries) {
      var stats = updateStatsForEndedTask(taskId);
      if (tickets[taskId]) {
        // Mark as a failure
        tickets[taskId].failed(msg);
        delete tickets[taskId];
      }
      self._failedTotal++;
      self.emit('task_failed', taskId, msg, stats);
    } else {
      // Pop back onto queue and retry
      self.emit('task_retry', taskId, self._retries[taskId]);
      self._queueTask(taskId, batch[taskId], tickets[taskId]);
    }
  })
  worker.on('task_finish', function (id, result) {
    var taskId = taskIds[id];
    var stats = updateStatsForEndedTask(taskId);
    if (tickets[taskId]) {
      tickets[taskId].finish(result);
      delete tickets[taskId];
    }
    self.emit('task_finish', taskId, result, stats);
  })
  worker.on('task_progress', function (id, progress) {
    var taskId = taskIds[id];
    if (tickets[taskId]) {
      tickets[taskId].progress(progress);
      delete tickets[taskId];
    }
    self.emit('task_progress', taskId, progress);
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
    if (timeout) {
      clearTimeout(timeout);
    }
    var finishAndGetNext = function () {
      self._running--;
      taskIds.forEach(function (taskId) {
        delete self._workers[taskId];
      });
      self._processIfFull();
    }
    if (self.afterProcessDelay) {
      setTimeout(function () {
        finishAndGetNext()
      }, self.afterProcessDelay);
    } else {
      setImmediate(function () {
        finishAndGetNext()
      })
    }
  })

  // Acquire lock on process
  self._running++;
  worker.start();

  taskIds.forEach(function (taskId) {
    self._workers[taskId] = worker || {};
    self.emit('task_started', taskId, batch[taskId])
  });
}

module.exports = Queue;
