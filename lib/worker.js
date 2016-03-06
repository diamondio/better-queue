
var util = require('util');
var EE   = require('events').EventEmitter;
var ETA  = require('node-eta');

function Worker(opts) {
  this.fn = opts.fn;
  this.batch = opts.batch;
  this.single = opts.single;
  this.active = false;
}

util.inherits(Worker, EE);

Worker.prototype.setup = function () {
  var self = this;

  // Internal
  self._taskIds = Object.keys(self.batch);
  self._process = {};
  self._waiting = {};
  self._eta = new ETA();

  // Task counts
  self.counts = {
    finished: 0,
    failed: 0,
    completed: 0,
    total: self._taskIds.length,
  };

  // Progress
  self.status = 'ready';
  self.progress = {
    tasks: {},
    complete: 0,
    total: self._taskIds.length,
    eta: '',
  };

  // Setup
  self._taskIds.forEach(function (taskId) {
    self._waiting[taskId] = true;
    self.progress.tasks[taskId] = {
      pct: 0,
      complete: 0,
      total: self.batch[taskId].total || 1,
    }
    self.progress.total += self.batch[taskId].total || 1;
  })
}

Worker.prototype.start = function () {
  var self = this;
  if (self.active) return;

  self.setup();
  self._eta.count = self.progress.total;
  self._eta.start();

  self.active = true;
  self.status = 'in-progress';
  var tasks = self.batch;
  if (self.single) {
    tasks = self.batch[self._taskIds[0]]
  }
  self._process = self.fn.call(self, tasks, function (err, result) {
    if (!self.active) return;
    if (err) {
      self.failed(err.message || err);
    } else {
      self.finish(result);
    }
  });
  self._process = self._process || {};
}

Worker.prototype.end = function () {
  if (!this.active) return;
  this.status = 'finished';
  this.active = false;
  this.emit('end');
}

Worker.prototype.resume = function () {
  if (typeof this._process.resume === 'function') {
    this._process.resume();
  }
  this.status = 'in-progress';
}

Worker.prototype.pause = function () {
  if (typeof this._process.pause === 'function') {
    this._process.pause();
  }
  this.status = 'paused';
}

Worker.prototype.cancel = function () {
  if (typeof this._process.cancel === 'function') {
    this._process.cancel();
  }
  if (typeof this._process.abort === 'function') {
    this._process.abort();
  }
  this.failed('cancelled');
}

Worker.prototype.failed = function (taskId, msg) {
  var self = this;
  if (!self.active) return;
  if (msg === undefined) {
    // Apply to remaining
    msg = taskId;
    Object.keys(self._waiting).forEach(function (taskId) {
      self.failed(taskId, msg);
    })
    self.end();
  } else {
    // Apply to taskId
    delete self._waiting[taskId];
    self.counts.failed++;
    self.counts.completed++;
    self.emit('task_failed', taskId, msg);
  }
}

Worker.prototype.finish = function (taskId, result) {
  var self = this;
  if (!self.active) return;
  if (result === undefined) {
    // Apply to remaining
    result = taskId;
    Object.keys(self._waiting).forEach(function (taskId) {
      self.finish(taskId, result);
    })
    self.end();
  } else {
    // Apply to taskId
    delete self._waiting[taskId];
    self.counts.finished++;
    self.counts.completed++;
    self.emit('task_finish', taskId, result);
  }
}

Worker.prototype.progress = function (taskId, completed) {
  var self = this;
  if (!self.active) return;
  if (completed === undefined) {
    // Apply to remaining
    completed = taskId;
    Object.keys(self._waiting).forEach(function (taskId) {
      self.progress(taskId, completed*self.progress.tasks[taskId].total);
    })
  } else {
    // Apply to taskId
    self.progress.complete = 0;
    self.progress.tasks[taskId].complete = completed;
    self.progress.tasks[taskId].pct = Math.max(0, Math.min(1, completed/self.progress.tasks[taskId].total));
    self._taskIds.forEach(function (taskId) {
      self.progress.complete += self.progress.tasks[taskId].pct;
    })
    self._eta.done = self.progress.complete;
    self.progress.eta = self._eta.format('{{etah}}')
    self.emit('task_progress', taskId, completed);
  }
}

module.exports = Worker;
