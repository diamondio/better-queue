var assert = require('assert');
var Queue = require('../lib/queue');
var MemoryStore = require('../lib/stores/memory');

describe('Store Usage', function() {

  it('should retry connect', function (done) {
    var tries = 0;
    var s = {
      connect: function (cb) {
        tries++;
        if (tries < 3) {
          return cb('failed');
        }
        done();
      },
      getTask: function (taskId, cb) { cb() },
      putTask: function (taskId, task, priority, cb) { cb() },
      takeFirstN: function (n, cb) { cb() },
      takeLastN: function (n, cb) { cb() }
    }
    var q = new Queue(function (batch, cb) { cb() }, {
      storeMaxRetries: 5,
      storeRetryTimeout: 1,
      store: s
    })
  })

  it('should fail retry', function (done) {
    var tries = 0;
    var s = {
      connect: function (cb) {
        tries++;
        cb('failed');
      },
      getTask: function (taskId, cb) { cb() },
      putTask: function (taskId, task, priority, cb) { cb() },
      takeFirstN: function (n, cb) { cb() },
      takeLastN: function (n, cb) { cb() }
    }
    var q = new Queue(function (batch, cb) { cb() }, {
      storeMaxRetries: 2,
      storeRetryTimeout: 1,
      store: s
    })
      .on('error', function (e) {
        assert.ok(e);
        done();
      })
  })

  it('should queue length', function (done) {
    var queued = false;
    var s = {
      connect: function (cb) { cb(null, 5) },
      getTask: function (taskId, cb) { cb() },
      putTask: function (taskId, task, priority, cb) { cb() },
      takeFirstN: function (n, cb) { cb(null, { 'task-id': queued ? 2 : 1 }) },
      takeLastN: function (n, cb) { cb() }
    }
    var q = new Queue(function (n, cb) {
      if (n === 2) {
        assert.equal(q.length, 5);
        done();
      }
      cb();
    }, { store: s, autoResume: false })
    q.push(1).on('queued', function (e) {
      queued = true;
      assert.equal(q.length, 6);
    })
  })

  // TODO: Test progress
  // TODO: Test the actual stores

})
