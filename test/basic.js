var assert = require('assert');
var Queue = require('../lib/queue');

describe('Basic Queue', function() {

  it('should succeed', function (done) {
    var q = new Queue(function (n, cb) {
      cb(null, n+1)
    })
    q.on('task_finish', function (taskId, r) {
      assert.equal(r, 2);
      done();
    })
    q.push(1, function (err, r) {
      assert.equal(r, 2);
    })
  });

  it('should fail', function (done) {
    var q = new Queue(function (n, cb) {
      cb('nope')
    })
    q.on('task_failed', function (taskId, msg) {
      assert.equal(msg, 'nope');
      done();
    })
    q.push(1, function (err, r) {
      assert.equal(err, 'nope');
    })
  });

  it('should prioritize', function (done) {
    var q = new Queue(function (num, cb) { cb() }, {
      priority: function (n, cb) {
        if (n === 2) return cb(null, 10);
        if (n === 1) return cb(null, 5);
        return cb(null, 1);
      }
    })
    q.pause();
    var finished = 0;
    var queued = 0;
    q.on('task_queued', function () {
      queued++;
      if (queued === 3) {
        q.resume();
      }
    })
    q.push(3, function (err, r) {
      assert.equal(finished, 2);
      finished++;
    });
    q.push(2, function (err, r) {
      assert.equal(finished, 0);
      finished++;
    });
    q.push(1, function (err, r) {
      assert.equal(finished, 1);
      finished++;
      done()
    });
  })

  it('should run filo', function (done) {
    var finished = 0;
    var queued = 0;
    var q = new Queue(function (num, cb) {
      cb();
    }, { filo: true })
    q.on('task_finish', function () {
      if (finished >= 3) {
        done();
      }
    })
    q.on('task_queued', function () {
      queued++;
      if (queued >= 3) {
        q.resume();
      }
    })
    q.pause();
    q.push(1, function (err, r) {
      assert.equal(finished, 2);
      finished++;
    }).on('queued', function () {
      q.push(2, function (err, r) {
        assert.equal(finished, 1);
        finished++;
      }).on('queued', function () {
        q.push(3, function (err, r) {
          assert.equal(finished, 0);
          finished++;
        })
      })
    })
  })

  it('should filter before process', function (done) {
    var q = new Queue(function (n, cb) { cb(null, n) }, {
      filter: function (n, cb) {
        cb(null, n === 2 ? false : n);
      }
    })
    q.push(2, function (err, r) {
      assert.equal(err, 'input_rejected');
    })
    q.push(3, function (err, r) {
      assert.equal(r, 3);
      done();
    })
  })

  it('should drain and empty', function (done) {
    var emptied = false;
    var q = new Queue(function (n, cb) { cb() })
    q.on('empty', function () {
      emptied = true;
    })
    q.on('drain', function () {
      assert.ok(emptied);
      done();
    });
    q.push(1)
    q.push(2)
    q.push(3)
  })

  it('should queue 50 things', function (done) {
    var q = new Queue(function (n, cb) {
      cb(null, n+1);
    })
    var finished = 0;
    for (var i = 0; i < 50; i++) {
      (function (n) {
        q.push(n, function (err, r) {
          assert.equal(r, n+1);
          finished++;
          if (finished === 50) {
            done();
          }
        })
      })(i)
    }
  })

  it('should concurrently handle tasks', function (done) {
    var concurrent = 0;
    var ok = false;
    var q = new Queue(function (n, cb) {
      var wait = function () {
        if (concurrent === 3) {
          ok = true;
        }
        if (ok) return cb();
        setImmediate(function () {
          wait();
        })
      }
      concurrent++;
      wait();
    }, { concurrent: 3 })
    var finished = 0;
    var finish = function () {
      finished++;
      if (finished >= 4) {
        done();
      }
    }
    q.push(0, finish);
    q.push(1, finish);
    q.push(2, finish);
    q.push(3, finish);
  })
  
  it('should pause and resume', function (done) {
    var running = false;
    var q = new Queue(function (n, cb) {
      running = true;
      return {
        pause: function () {
          running = false;
        },
        resume: function () {
          running = true;
          cb();
          done();
        }
      }
    })
    q.pause();
    q.push(1)
      .on('started', function () {
        setTimeout(function () {
          assert.ok(running);
          q.pause();
          assert.ok(!running);
          q.resume();
        }, 1)
      })
    assert.ok(!running);
    q.resume();
  })

})
