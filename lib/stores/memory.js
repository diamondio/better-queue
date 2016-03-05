
function MemoryStore() { 
  this._queue = [];   // Array of taskIds
  this._tasks = {};   // Map of taskId => task 
}

MemoryStore.prototype.getTask = function (taskId, cb) {
  return cb(null, this._tasks[taskId]);
}

MemoryStore.prototype.putTask = function (taskId, task, cb) {
  this._tasks[taskId] = task;
  cb();
}

MemoryStore.prototype.putPriority = function (taskId, priority, cb) {
  var self = this;
  if (self._queue.indexOf(taskId) === -1) {
    self._queue.push(taskId);
  }
  // TODO: Sort the MemoryStore
  cb();
}

MemoryStore.prototype.getFirstN = function (n, cb) {
  var self = this;
  var taskIds = self._queue.splice(0, n);
  var tasks = {};
  taskIds.forEach(function (taskId) {
    tasks[taskId] = self._tasks[taskId];
    delete self._tasks[taskId];
  })
  cb(null, tasks);
}

MemoryStore.prototype.getLastN = function (n, cb) {
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
