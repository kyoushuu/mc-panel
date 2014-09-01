
/**
 * Module dependencies.
 */

var express = require('express');
var http = require('http');
var path = require('path');

var spawn = require('child_process').spawn;
var readline = require('readline');
var AdmZip = require('adm-zip');
var fs = require('fs');
var formidable = require('formidable');
var rmdir = require('rimraf');

var app = express();

// all environments
app.set('port',
        process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || 3000);
app.set('ipaddress',
        process.env.OPENSHIFT_NODEJS_IP || process.env.IP || '127.0.0.1');
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

function downloadMap(stream, callback) {
    if (status === 'stopped') {
        var zip = new AdmZip();
        zip.addLocalFolder('world');
        callback(null, zip.toBuffer());
        return;
    }

    var autosave = true;

    rl.on('line', function autosaveOff(line) {
        if (line.indexOf('[INFO] Turned off world auto-saving') >= 0 ||
            line.indexOf('[INFO] Saving is already turned off.') >= 0) {
            rl.removeListener('line', autosaveOff);

            server.stdin.write('save-all\n');

            autosave = line.indexOf('[INFO] Turned off world auto-saving') >= 0;
        }
    });

    rl.on('line', function savedAll(line) {
        if (line.indexOf('[INFO] Saved the world') >= 0) {
            rl.removeListener('line', savedAll);

            var zip = new AdmZip();
            zip.addLocalFolder('world');
            callback(null, zip.toBuffer());

            if (autosave) {
                server.stdin.write('save-on\n');
            }
        }
    });

    server.stdin.write('say Saving the world for download...\n');
    server.stdin.write('save-off\n');
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

app.get('/stop', function(req, res) {
    stop(function(error) {
        res.render('stop', { error: error });
    });
});

app.get('/download', function(req, res, next) {
    downloadMap(res, function(error, buffer) {
        if (error) {
            next(error);
        }

        res.attachment('world.zip');
        res.send(buffer);
    });
});

app.get('/upload', function(req, res) {
    res.render('upload');
});

app.post('/upload', function(req, res) {
    if (status !== 'stopped') {
        res.render('upload', { error: 'Server is still running' });
        return;
    }

    var form = new formidable.IncomingForm;

    form.parse(req, function(error, fields, files) {
        if (error) {
            res.render('upload', { error: error });
            return;
        }

        if (!files.map) {
            res.render('upload');
            return;
        }

        var zip = new AdmZip(files.map.path);

        if (zip.getEntry('level.dat')) {
            fs.rename('world', 'world-bak', function(error) {
                try {
                    zip.extractAllTo('world', true);
                    rmdir('world-bak', function(error) {
                        res.render('upload', { path: files.map.path });
                    });
                } catch (error) {
                    fs.rename('world-bak', 'world', function(error) {
                        res.render('upload', {
                            error: 'Failed to extract the file'
                        });
                    });
                }
            });
        } else {
            res.render('upload', {
                error: 'File level.dat not found in the root of the zip file'
            });
        }
    });
});


http.createServer(app).listen(app.get('port'), app.get('ipaddress'), function() {
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

