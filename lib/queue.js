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
  self._fetchingNext = false;
  self._tasksWaitingForConnect = [];

  self._calledDrain = true;
  self._calledEmpty = true;
  self._running = 0;  // Active running tasks
  self._retries = {}; // Map of taskId => retries
  self._workers = {}; // Map of taskId => active job
  self._tickets = {}; // Map of taskId => tickets

  // Initialize Storage
  self.use(opts.store || 'sqlite');
  if (!self._store) {
    throw new Error('Queue cannot continue without a valid store.')
  }
}

util.inherits(Queue, EE);

Queue.prototype.destroy = function () {
  if (typeof this._store.close === 'function') {
    this._store.close();
  }

  // Statuses
  self._hasMore = false;
  self._isWriting = false;
  self._writeQueue = [];
  self._writing = {};
  self._fetchingNext = false;
  self._tasksWaitingForConnect = [];

  // Clear internals
  self._tickets = {};
  self._workers = {};
  self._running = {};
  self._retries = {};
  self._calledEmpty = true;
  self._calledDrain = true;
  self._stopped = false;
  self._connected = false;
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
    self._connected = true;
    self.length = len;
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
    if (err) {
      self._tickets[taskId].failed('failed_to_put_task');
      return finishedWrite();
    }
    // If something else has written to taskId, then wait.
    if (self._writing[taskId].id !== writeId) {
      self._writeQueue.unshift(taskId);
      return finishedWrite();
    }
    delete self._writing[taskId];

    // Task is in the queue
    self.length++;
    self.emit('task_queued', taskId, task);
    self._tickets[taskId].queued();

    // If it's a new task, make sure to call drain after.
    if (isNew) {
      self._calledDrain = false;
      self._calledEmpty = false;
    }

    // If already fetching, mark that there are additions to the queue
    if (self._fetchingNext) {
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
    if (!self._tickets[taskId]) {
      self._tickets[taskId] = new Tickets();
    }
    self._tickets[taskId].push(ticket);

    // Add to queue
    var alreadyQueued = !!self._writing[taskId];
    self._writing[taskId] = {
      id: uuid.v4(),
      isNew: !oldTask,
      task: newTask,
      priority: priority
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
  self._saturated = (self._running >= self.concurrent);
  if (!self._connected) return;
  if (self._saturated) return;
  if (self._stopped) return;
  if (self._fetchingNext) return;
  if (!self.length) {
    if (!self._hasMore) {
      self._emptied();
      if (!self._running) {
        self._drained();
      }
    }
    return;
  }

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

  // Fetch next batch
  // FIXME: There may still be things writing
  self._hasMore = false;
  self._fetchingNext = true;
  self._getNextBatch(function (err, batch) {
    self._fetchingNext = false;
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

    // TODO: Collect stats

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
    self._running--;
    if (timeout) {
      clearTimeout(timeout);
    }
    taskIds.forEach(function (taskId) {
      delete self._workers[taskId];
    });
    if (self.afterProcessDelay) {
      setTimeout(function () {
        self._processIfFull();
      }, self.afterProcessDelay);
    } else {
      setImmediate(function () {
        self._processIfFull();
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
