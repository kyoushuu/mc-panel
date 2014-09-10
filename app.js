/*
 * mc-panel - Minecraft Control Panel
 * Copyright (C) 2014 Arnel A. Borja <arnel@arnelborja.com>
 *
 * This is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program.  If not, see <http://www.gnu.org/licenses/>.
 */


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
var tmp = require('tmp');
var moment = require('moment');

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
var cwd = process.env.OPENSHIFT_DATA_DIR || '';


function start(callback) {
    if (status !== 'stopped') {
        callback('Server is already running');
        return;
    }

    status = 'starting';

    server = spawn('java', [
        '-Xmx768M', '-Xms768M',
        '-jar', cwd + 'minecraft_server.jar',
        'nogui'
    ], { cwd: cwd });

    rl = readline.createInterface({
        input: server.stdout,
        output: server.stdin,
        terminal: false
    });

    rl.on('line', function (line) {
        console.log(line);

        if (line.indexOf('[Server thread/INFO]: Done') >= 0) {
            status = 'started';
        }

        if (line.indexOf('[Server thread/INFO]: Stopping server') >= 0) {
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

function zipMapFolder(callback) {
    var zip = new AdmZip();
    zip.addLocalFolder(cwd + 'world');
    zip.toBuffer(function(buffer) {
        callback(null, buffer);
    }, function(error) {
        callback(error);
    });
}

function downloadMap(stream, callback) {
    if (status === 'stopped') {
        zipMapFolder(function (error, buffer) {
            if (error) {
                callback(error);
                return;
            }

            callback(null, buffer);
        });

        return;
    }

    var autosave = true;

    rl.on('line', function autosaveOff(line) {
        if (line.indexOf('[Server thread/INFO]: Turned off world auto-saving') >= 0 ||
            line.indexOf('[Server thread/INFO]: Saving is already turned off.') >= 0) {
            rl.removeListener('line', autosaveOff);

            server.stdin.write('save-all\n');

            autosave = line.indexOf('[Server thread/INFO]: Turned off world auto-saving') >= 0;
        }
    });

    rl.on('line', function savedAll(line) {
        if (line.indexOf('[Server thread/INFO]: Saved the world') >= 0) {
            rl.removeListener('line', savedAll);

            zipMapFolder(function (error, buffer) {
                if (error) {
                    callback(error);
                    return;
                }

                if (autosave) {
                    server.stdin.write('save-on\n');
                }

                callback(null, buffer);
            });
        }
    });

    server.stdin.write('say Saving the world for download...\n');
    server.stdin.write('save-off\n');
}

function uploadMap(path, callback) {
    var zip = new AdmZip(path);
    if (zip.getEntry('level.dat')) {
        fs.rename(cwd + 'world', cwd + 'world-bak', function(error) {
            try {
                zip.extractAllTo(cwd + 'world', true);
                rmdir(cwd + 'world-bak', function(error) {
                    callback();
                });
            } catch (error) {
                fs.rename(cwd + 'world-bak', cwd + 'world', function(error) {
                    callback('Failed to extract the file');
                });
            }
        });
    } else {
        callback('File level.dat not found in the root of the zip file');
    }
}

function uploadMapFromLink(url, callback) {
    tmp.tmpName({ keep: true }, function(error, path) {
        if (error) {
            callback(error);
            return;
        }

        var file = fs.createWriteStream(path);
        var request = http.get(url, function(response) {
            file.on('finish', function() {
                uploadMap(path, function(error) {
                    if (error) {
                        callback(error);
                        return;
                    }

                    fs.unlink(path, function (error) {
                        if (error) {
                            callback(error);
                            return;
                        }

                        callback();
                    });
                });
            });

            response.pipe(file);
        });

        request.on('error', function(error) {
            callback(error);
        });
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

        res.attachment('world-' + moment().format('YYYYMMDD-HHmm') + '.zip');
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

        if (fields.url) {
            uploadMapFromLink(fields.url, function(error) {
                if (error) {
                    res.render('upload', { error: error });
                    return;
                }

                res.render('upload', { path: fields.url });
            });

            return;
        } else if (!files.map) {
            res.render('upload');
            return;
        }

        uploadMap(files.map.path, function(error) {
            if (error) {
                res.render('upload', { error: error });
                return;
            }

            res.render('upload', { path: files.map.path });
        });
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


signalStop = function() {
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
};

process.on('SIGINT', signalStop);
process.on('SIGTERM', signalStop);

