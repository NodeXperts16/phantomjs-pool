
var Worker = require('./WorkerControl');
var fs = require('fs');

function Pool(options) {
    this.size = options.numWorkers || 2;
    this.spawnWorkerDelay = options.spawnWorkerDelay || 0;
    this.phantomjsOptions = options.phantomjsOptions || [];
    this.verbose = options.verbose || false;
    this.workerTimeout = (options.workerTimeout || 180) * 1000;

    this.jobID = 1;

    if (options.phantomjsBinary) {
        this.phantomjsBinary = options.phantomjsBinary;
    } else {
        // Check if PhantomJS is installed
        var phantomjsLib;
        try {
            phantomjsLib = require('phantomjs-prebuilt');
        } catch (e) {} // Do nothing, we were just checking
        try {
            phantomjsLib = require('phantomjs');
        } catch (e) {}
        try {
            phantomjsLib = require('phantomjs2');
        } catch (e) {}

        if (phantomjsLib) {
            this.phantomjsBinary = phantomjsLib.path;
        } else {
            throw new Error('PhantomJS binary not found. Use the option phantomjsBinary or install phantomjs via npm.');
        }
    }

    if (!options.workerFile) {
        throw new Error('workerFile in options expected.');
    }
    
    this.workerFile = options.workerFile;

    this.workers = [];
    this.workersQueue = [];
}

// Adds workers until the pool size is reached
Pool.prototype.spawnWorkers = function () {
    var that = this;
    
    //Checking if there are times in queue for more that configure time
    var currentTime = new Date().getTime();
    for(var i = this.workersQueue.length - 1; i >= 0 ; i--) {
        if(currentTime - this.workersQueue[i].time > this.workerTimeout) {
            if(this.verbose) {
                console.log('Pushing JOB for deletion: ' + this.workersQueue[i].jobID);
            }
            this.addWorker(this.workersQueue[i]);
            this.workersQueue.splice(i, 1);
        }
    }
   
    if (this.size > this.workers.length && this.workersQueue.length !== 0) {
        console.log(this.workersQueue[0]);
        this.addWorker(this.workersQueue[0]);
        if(this.verbose) {
            console.log('Pushing JOB for processing: ' + this.workersQueue[0].jobID);
        }
        this.workersQueue.splice(0, 1);
    }
    
    /*
     * SpawnWorker only if there are items in queue, 
        otherwise it will be reactivated by pushing the items into queue.
     */
    if(this.workersQueue.length) {
        setTimeout(function () {
            that.spawnWorkers();
        }, this.spawnWorkerDelay);
    }
};

// adds one worker to the pool
Pool.prototype.addWorker = function (worker) {
    if (this.verbose) {
        console.log('Creating worker #' + worker.jobID);
    }
    
    this.workers.push(Worker.create(this, worker));
    
};

Pool.prototype.start = function () {
    if (this.verbose) {
        console.log('Starting spawning workers');
    }
    this.spawnWorkers();
};

Pool.prototype.pushWorkerInQueue = function (callback) {
    
    this.workersQueue.push({callback: callback, jobID: this.jobID++, time: new Date().getTime()});
    
    if(this.workersQueue.length === 1) {
        this.spawnWorkers();
    }
    
    if (this.verbose) {
        console.log('Job pushed to queue');
    }
};

Pool.prototype.removeWorker = function (jobID) {
    for(var i = 0; i < this.workers.length; i++) {
         if(this.workers[i]['jobID'] === jobID) {
             this.workers.splice(i, 1);
             console.log('remove worker job');
             break;
         }
    }
};

module.exports = Pool;