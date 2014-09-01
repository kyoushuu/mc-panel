
/**
 * Module dependencies.
 */

var express = require('express');
var http = require('http');
var path = require('path');

var spawn = require('child_process').spawn;
var readline = require('readline');

var app = express();

// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');
app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.json());
app.use(express.urlencoded());
app.use(express.methodOverride());
app.use(app.router);
app.use(require('less-middleware')({ src: path.join(__dirname, 'public') }));
app.use(express.static(path.join(__dirname, 'public')));

// development only
if ('development' == app.get('env')) {
  app.use(express.errorHandler());
}


var status = 'stopped';
var server = null;
var rl = null;


function start(callback) {
    if (status !== 'stopped') {
        callback('Server is already running');
        return;
    }

    status = 'starting';

    server = spawn('java', [
        '-Xmx490M', '-Xms490M',
        '-jar', 'minecraft_server.jar',
        'nogui'
    ]);

    rl = readline.createInterface({
        input: server.stderr,
        output: server.stdin,
        terminal: false
    });

    rl.on('line', function (line) {
        console.log(line);

        if (line.indexOf('[INFO] Done') >= 0) {
            status = 'started';
        }

        if (line.indexOf('[INFO] Stopping server') >= 0) {
            status = 'stopping';
        }
    });

    server.on('close', function (code) {
        status = 'stopped';
        rl = null;
    });

    callback();
}

function stop(callback) {
    if (server === null) {
        callback('Server is not running');
        return;
    }

    if (status !== 'started') {
        callback('Server is busy');
        return;
    }

    server.stdin.write('stop\n');

    server.once('close', function (code) {
        callback();
    });
}

/*
 * GET home page.
 */

app.get('/', function(req, res) {
    res.render('index', { title: 'Express', status: status });
});

app.get('/start', function(req, res) {
    start(function(error) {
        res.render('start', { error: error });
    });
});


http.createServer(app).listen(app.get('port'), function() {
    console.log('Express server listening on port ' + app.get('port'));
    console.log('Starting server...');
    start(function(error) {
        if (error) {
            console.log('Failed to start Minecraft server: ' + error);
            return;
        }

        console.log('Server has been started');
    });
});


process.on('SIGINT', function() {
    if (status !== 'stopped') {
        console.log('Stopping server...');
        stop(function(error) {
            console.log('Server has been stopped');
            process.exit();
        });
    } else {
        console.log('Server is already stopped');
        process.exit();
    }
});

