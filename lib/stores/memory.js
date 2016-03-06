
function stableSort(arr, compare) {
  var wrapper = arr.map(function (item, idx) {
    return { item: item, idx: idx };
  });

  wrapper.sort(function (a, b) {
    return compare(a.item, b.item) || (a.idx - b.idx);
  });

  return wrapper.map(function (w) { return w.item });
}

function MemoryStore() { 
  this._queue = [];      // Array of taskIds
  this._tasks = {};      // Map of taskId => task
  this._priorities = {}; // Map of taskId => priority
}

MemoryStore.prototype.connect = function (cb) {
  cb()
}

MemoryStore.prototype.getTask = function (taskId, cb) {
  return cb(null, this._tasks[taskId]);
}

MemoryStore.prototype.putTask = function (taskId, task, priority, cb) {
  var self = this;
  self._tasks[taskId] = task;
  if (self._queue.indexOf(taskId) === -1) {
    self._queue.push(taskId);
  }
  if (priority !== undefined) {
    self._priorities[taskId] = priority;
    self._queue = stableSort(self._queue, function (a, b) {
      if (self._priorities[a] < self._priorities[b]) return 1;
      if (self._priorities[a] > self._priorities[b]) return -1;
      return 0;
    })
  }
  cb();
}

MemoryStore.prototype.takeFirstN = function (n, cb) {
  var self = this;
  var taskIds = self._queue.splice(0, n);
  var tasks = {};
  taskIds.forEach(function (taskId) {
    tasks[taskId] = self._tasks[taskId];
    delete self._tasks[taskId];
  })
  cb(null, tasks);
}

MemoryStore.prototype.takeLastN = function (n, cb) {
  var self = this;
  var taskIds = self._queue.splice(-n).reverse();
  var tasks = {};
  taskIds.forEach(function (taskId) {
    tasks[taskId] = self._tasks[taskId];
    delete self._tasks[taskId];
  })
  cb(null, tasks);
}

module.exports = MemoryStore;
