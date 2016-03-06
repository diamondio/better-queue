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

  it('should run fifo', function (done) {
    var q = new Queue(function (num, cb) { cb() })
    var finished = 0;
    q.push(3, function (err, r) {
      assert.equal(finished, 0);
      finished++;
    })
    q.push(2, function (err, r) {
      assert.equal(finished, 1);
      finished++;
    })
    setImmediate(function () {
      q.push(1, function (err, r) {
        assert.equal(finished, 2);
        finished++;
        done()
      })
    })
  })

  it('should run filo', function (done) {
    var q = new Queue(function (num, cb) { cb() }, { filo: true })
    var finished = 0;
    q.push(1, function (err, r) {
      assert.equal(finished, 2);
      finished++;
      done();
    })
    q.push(2, function (err, r) {
      assert.equal(finished, 1);
      finished++;
    })
    q.push(3, function (err, r) {
      assert.equal(finished, 0);
      finished++;
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
    var q = new Queue(function (n, cb) { cb() }, {
      empty: function () {
        emptied = true;
      },
      drain: function () {
        assert.ok(emptied);
        done();
      }
    })
    q.push(1)
    q.push(2)
    q.push(3)
  })

  it('should queue 200 things', function (done) {
    var q = new Queue(function (n, cb) {
      cb(null, n+1);
    })
    var finished = 0;
    for (var i = 0; i < 200; i++) {
      (function (n) {
        q.push(n, function (err, r) {
          assert.equal(finished, n);
          assert.equal(r, n+1);
          finished++;
          if (n === 199) {
            done();
          }
        })
      })(i)
    }
  })

  it('should concurrently handle tasks', function (done) {
    var locks = {};
    var ok = false;
    var q = new Queue(function (n, cb) {
      locks[n] = true;
      var wait = function () {
        if (locks[0] && locks[1] && locks[2]) {
          ok = true;
          locks[n] = false;
          cb();
        } else if (ok) {
          locks[n] = false;
          cb();
        } else {
          setImmediate(function () {
            wait();
          })
        }
      }
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
    q.push(1);
    setTimeout(function () {
      assert.ok(running);
      q.pause();
      assert.ok(!running);
      q.resume();
  }, 1)
  })

})
