
var cp = require('child_process');
var http = require('http');
var querystring = require('querystring');

var phantomjsBinPath = '/../../bin/phantomjs';

var VERBOSE = false;

function log(workerId, msg) {
    if (VERBOSE) {
        console.log('    #' + workerId + ' ' + msg);
    }
}

function createError(workerId, msg) {
    var err = new Error(msg);
    err.workerId = workerId;
    return err;
}

function Worker(pool, worker) {
    this.jobID = worker.jobID;
    
    this.workerData = {
        jobID: this.jobID,
        time: worker.time
    };
    
    this.pool = pool;
    this.createProcess();
    this.waitingTimeout = null;
    if (this.pool.verbose) {
        VERBOSE = true;
    }
    this.worker = worker;
    this.alive = true;
}

// Create process of PhantomJS worker
Worker.prototype.createProcess = function() {

    var that = this;
    this.port = undefined;

    var clArgs = [__dirname + '/../../lib/worker/Worker.js', this.jobID, this.pool.workerFile];
    if (this.pool.phantomjsOptions) {
        clArgs.unshift.apply(clArgs, this.pool.phantomjsOptions);
    }

    // Spawn process
    this.proc = cp.spawn(that.pool.phantomjsBinary, clArgs, { cwd : process.cwd() });
    
    this.proc.on('error', function (err) {
        if (err.message.indexOf('ENOENT') !== -1) {
            throw new Error('phantomjsBinary not found: ' + that.pool.phantomjsBinary + ' (Full error: ' + err.message + ')');
        } else {
            throw new Error('Problem starting the PhantomJS process: ' + err.message);
        }
    });
    
    this.proc.stdout.on('data', function (rawData) {
        var data = rawData.toString();

        // parse first data from the worker and interpret it as port number or output it
        if (that.port === undefined && data.indexOf('#|#port#|#') !== -1) {
            var splitted = data.split('#|#port#|#');
            that.port = parseInt(splitted[1]);
            log(that.jobID, ' starting on port: ' + that.port);

            // we are now ready setup and can start working
            that.readyForWork();
        } else {
            // output logging calls of the custom worker of the user
            data.split('\n').forEach(function(line) {
                if (line.trim().length !== 0) {
                    console.log('  #' + that.jobID + ' >> ' + line);
                }
            });
        }
    });

};


// called when the worker has no job and is ready to receive work
Worker.prototype.readyForWork = function() {
    if (this.currentJob) {
        log(this.jobID, 'ignoring the last job: ' + JSON.stringify(this.currentJob.data));
    }

    var that = this;
    that.worker.callback(function (data, doneCallback) {
        that.work(data, doneCallback);
    }, that.workerData);
};

// called when the worker has returned response
Worker.prototype.removeWorker = function() {
    if (this.proc) {
        log(this.jobID, 'closing worker');
        this.proc.kill();
    }
};

// called by master -> contains a new job and a callback that should be called when the job is done or erroneous
Worker.prototype.work = function(data, givenJobCallback) {
    var that = this;
    that.currentJob = {
        data : data,
        callback : givenJobCallback
    };
    
    log(that.jobID, 'new job ' + JSON.stringify(data));

    function jobCallback(err, data) {
        if (givenJobCallback) {
            givenJobCallback(err, data);
        }
    }
    
    // we will now send this job the the phantomJS instance via REST
    // the phantomJS instance has a port opened for this which accepts REST calls

    // The data we want to submit via POST
    var postData = querystring.stringify({
        data : JSON.stringify(data)
    });

    // parameters for the request
    var options = {
        hostname: '127.0.0.1',
        port: this.port,
        path: '/',
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': postData.length
        }
    };

    // start a timeout that kills the job and process if we do not receive an answer from the worker in time
    that.waitingTimeout = setTimeout(function() {
        log(this.jobID, 'worker seems to be dead, we got no response for ' + JSON.stringify(data) + ' / ' + (new Date()).toString());
        jobCallback(createError(this.jobID, 'Worker Timeout'));
        that.waitingTimeout = null;
        workerRequest.abort();
        that.removeWorker();
        //that.createProcess(); // this will kill the current running job and restart a new process
    }, that.pool.workerTimeout);

    // the actual request
    var workerRequest = http.request(options, function(res) {
        var body = '';
        res.on('data', function (chunk) {
            body += chunk; // append chunks to get the whole body
        });

        // we got our response, let's check what's in the box
        res.on('end', function () {
            if (that.waitingTimeout) {
                clearTimeout(that.waitingTimeout); // clear the "worker did not answer" timeout
                try {
                    log(that.jobID, 'received result: ' + body);
                    // parse results and pass them to our callback
                    var result = JSON.parse(body);
                    if (result.status === 'success') {
                        jobCallback(null, result.data);
                        that.removeWorker();
                    } else if (result.status === 'fail') {
                        jobCallback(createError(that.jobID, result.errMessage), result.data);
                        that.removeWorker();
                    }
                    that.currentJob = null;

                    // check if phatomjs instance will close down
                    // if the worker signals he is closing, then we just wait for its closing
                    // otherwise we get a job for the worker
                    /*if (!result.closing) {
                        that.readyForWork();
                    }*/
                } catch (jsonParseError) {
                    // if that happens, we are in trouble
                    jobCallback(createError(that.jobID, 'JSON.parse error (content: ' + body + ')'));
                    //that.createProcess();
                }
            }
        });
    });


    // send request
    workerRequest.write(postData);
    workerRequest.end();
};


// factory for simplicity
Worker.create = function(id, callback) {
    return new Worker(id, callback);
};

module.exports = Worker;