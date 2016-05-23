var extend = require('extend');

function PostgresAdapter(opts) {
  extend(this, opts);
}

PostgresAdapter.prototype.connect = function (cb) {
  if (this.knex) return cb();
  var connection = {
      database: this.dbname || 'template1',
      host: this.host || 'localhost',
      port: this.port || 5432,
      user: this.username || 'postgres',
      password: this.password || '',
    };
  this.knex = require('knex')({
    client: 'pg',
    connection: connection,
    debug: false,
    useNullAsDefault: true,
    pool: {
      min: 1,
      max: 8
    }
  });
  this.initialize(cb);
};

// http://stackoverflow.com/questions/1109061/insert-on-duplicate-update-in-postgresql
PostgresAdapter.prototype.initialize = function (cb) {
  var sql = '                                                                                                                     \n\
    CREATE OR REPLACE FUNCTION upsert_' + this.tableName + '(_id TEXT, _lock TEXT, _task TEXT, _priority NUMERIC) RETURNS VOID AS \n\
    $$                                                                                                                            \n\
    BEGIN                                                                                                                         \n\
        LOOP                                                                                                                      \n\
            -- first try to update the key                                                                                        \n\
            -- note that "id" must be unique                                                                                      \n\
            UPDATE ' + this.tableName + ' SET lock=_lock, task=_task, priority=_priority WHERE id=_id;                            \n\
            IF found THEN                                                                                                         \n\
                RETURN;                                                                                                           \n\
            END IF;                                                                                                               \n\
            -- not there, so try to insert the key                                                                                \n\
            -- if someone else inserts the same key concurrently,                                                                 \n\
            -- we could get a unique-key failure                                                                                  \n\
            BEGIN                                                                                                                 \n\
                INSERT INTO ' + this.tableName + ' (id, lock, task, priority) VALUES (_id, _lock, _task, _priority);              \n\
                RETURN;                                                                                                           \n\
            EXCEPTION WHEN unique_violation THEN                                                                                  \n\
                -- do nothing, and loop to try the UPDATE again                                                                   \n\
            END;                                                                                                                  \n\
        END LOOP;                                                                                                                 \n\
    END;                                                                                                                          \n\
    $$                                                                                                                            \n\
    LANGUAGE plpgsql;                                                                                                             \n\
  ';
  this.knex.raw(sql).then(function (res) {
    cb();
  }).error(function (err) {
    cb(err);
  });
};

PostgresAdapter.prototype.upsert = function (properties, cb) {
  var args = [properties.id, properties.lock, properties.task, properties.priority];
  this.knex.raw("SELECT upsert_" + this.tableName + "(?, ?, ?, ?)", args)
    .then(function () { cb(); })
    .error(cb);
};

PostgresAdapter.prototype.close = function (cb) {
  var self = this;
  if (!self.knex) return cb();
  self.knex.raw('DROP FUNCTION IF EXISTS upsert_' + self.tableName + '(text, text, text, numeric)').then(function () {
    self.knex.schema.dropTableIfExists(self.tableName).then(function () { cb(); }).error(cb);
  }).error(cb);
};

module.exports = PostgresAdapter;
