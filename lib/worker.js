
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
  self._taskIds.forEach(function (taskId, id) {
    self._waiting[id] = true;
    self.progress.tasks[id] = {
      pct: 0,
      complete: 0,
      total: 1,
    }
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
  var tasks = self._taskIds.map(function (taskId) { return self.batch[taskId] });
  if (self.single) {
    tasks = tasks[0]
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

Worker.prototype.failed = function (id, msg) {
  var self = this;
  if (!self.active) return;
  if (msg === undefined) {
    // Apply to remaining
    msg = id;
    Object.keys(self._waiting).forEach(function (id) {
      if (!self._waiting[id]) return;
      self.failed(id, msg);
    })
    self.end();
  } else if (self._waiting[id]) {
    // Apply to id
    self._waiting[id] = false;
    self.counts.failed++;
    self.counts.completed++;
    self.emit('task_failed', id, msg);
  }
}

Worker.prototype.finish = function (id, result) {
  var self = this;
  if (!self.active) return;
  if (result === undefined) {
    // Apply to remaining
    result = id;
    Object.keys(self._waiting).forEach(function (id) {
      if (!self._waiting[id]) return;
      self.finish(id, result);
    })
    self.end();
  } else if (self._waiting[id]) {
    // Apply to id
    self._waiting[id] = false;
    self.counts.finished++;
    self.counts.completed++;
    self.emit('task_finish', id, result);
  }
}

Worker.prototype.progress = function (id, completed, total) {
  var self = this;
  if (!self.active) return;
  if (total === undefined) {
    // Apply to remaining
    completed = id;
    total = completed;
    Object.keys(self._waiting).forEach(function (id) {
      if (!self._waiting[id]) return;
      self.progress(id, completed, total);
    })
    self.progress.complete = 0;
    self._taskIds.forEach(function (taskId, id) {
      self.progress.complete += self.progress.tasks[id].pct;
    })
    self._eta.done = self.progress.complete;
    self.progress.eta = self._eta.format('{{etah}}')
    self.emit('progress', self.progress);
  } else if (self._waiting[id] && total !== 0) {
    // Apply to id
    self.progress.tasks[id].complete = completed;
    self.progress.tasks[id].total = total;
    self.progress.tasks[id].pct = Math.max(0, Math.min(1, completed/total));
    self.emit('task_progress', id, completed, total);
  }
}

module.exports = Worker;
