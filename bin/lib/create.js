#!/usr/bin/env node

/*
    Licensed to the Apache Software Foundation (ASF) under one
    or more contributor license agreements. See the NOTICE file
    distributed with this work for additional information
    regarding copyright ownership. The ASF licenses this file
    to you under the Apache License, Version 2.0 (the
    "License"); you may not use this file except in compliance
    with the License. You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing,
    software distributed under the License is distributed on an
    "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, either express or implied. See the License for the
    specific language governing permissions and limitations
    under the License.
*/

var shell = require('shelljs');
var path = require('path');
var fs = require('fs');
var ROOT = path.join(__dirname, '..', '..');

function updateSubprojectHelp () {
    console.log('Updates the subproject path of the CordovaLib entry to point to this script\'s version of Cordova.');
    console.log('Usage: CordovaVersion/bin/update_cordova_project path/to/your/app.xcodeproj [path/to/CordovaLib.xcodeproj]');
}

function setShellFatal (value, func) {
    var oldVal = shell.config.fatal;
    shell.config.fatal = value;
    func();
    shell.config.fatal = oldVal;
}

function copyJsAndCordovaLib (projectPath, projectName, use_shared) {
    shell.cp('-f', path.join(ROOT, 'CordovaLib', 'cordova.js'), path.join(projectPath, 'www'));
    shell.cp('-rf', path.join(ROOT, 'cordova-js-src'), path.join(projectPath, 'platform_www'));
    shell.cp('-f', path.join(ROOT, 'CordovaLib', 'cordova.js'), path.join(projectPath, 'platform_www'));

    fs.lstat(path.join(projectPath, 'CordovaLib'), function (err, stats) {
        if (!err) {
            if (stats.isSymbolicLink()) {
                fs.unlinkSync(path.join(projectPath, 'CordovaLib'));
            } else {
                shell.rm('-rf', path.join(projectPath, 'CordovaLib'));
            }
        }

        if (use_shared) {
            update_cordova_subproject([path.join(projectPath, projectName + '.xcodeproj', 'project.pbxproj')]);
            // Symlink not used in project file, but is currently required for plugman because
            // it reads the VERSION file from it (instead of using the cordova/version script
            // like it should).
            fs.symlinkSync(path.join(ROOT, 'CordovaLib'), path.join(projectPath, 'CordovaLib'));
        } else {
            var r = path.join(projectPath, projectName);
            var srcLib = path.join(ROOT, 'CordovaLib');
            var dstLib = path.join(projectPath, 'CordovaLib');
            shell.mkdir('-p', path.join(dstLib, 'CordovaLib.xcodeproj'));
            shell.cp('-f', path.join(r, '.gitignore'), projectPath);
            shell.cp('-rf', path.join(srcLib, 'CordovaLib'), dstLib);
            shell.cp('-f', path.join(srcLib, 'VERSION'), dstLib);
            shell.cp('-f', path.join(srcLib, 'cordova.js'), dstLib);
            shell.cp('-f', path.join(srcLib, 'CordovaLib', 'CordovaLib-Prefix.pch'), path.join(dstLib, 'CordovaLib'));
            shell.cp('-f', path.join(srcLib, 'CordovaLib.xcodeproj', 'project.pbxproj'), path.join(dstLib, 'CordovaLib.xcodeproj'));
            update_cordova_subproject([path.join(r + '.xcodeproj', 'project.pbxproj'), path.join(dstLib, 'CordovaLib.xcodeproj', 'project.pbxproj')]);
        }
    });
}

function copyScripts (projectPath) {
    var srcScriptsDir = path.join(ROOT, 'bin', 'templates', 'scripts', 'cordova');
    var destScriptsDir = path.join(projectPath, 'cordova');

    // Delete old scripts directory.
    shell.rm('-rf', destScriptsDir);

    // Copy in the new ones.
    var binDir = path.join(ROOT, 'bin');
    shell.cp('-r', srcScriptsDir, projectPath);

    const nodeModulesDir = path.join(ROOT, 'node_modules');
    if (fs.existsSync(nodeModulesDir)) shell.cp('-r', nodeModulesDir, destScriptsDir);

    // Copy the check_reqs script
    shell.cp(path.join(binDir, 'check_reqs*'), destScriptsDir);
    shell.cp(path.join(binDir, 'lib', 'check_reqs.js'), path.join(destScriptsDir, 'lib'));

    // Copy the version scripts
    shell.cp(path.join(binDir, 'apple_osx_version'), destScriptsDir);
    shell.cp(path.join(binDir, 'apple_xcode_version'), destScriptsDir);
    shell.cp(path.join(binDir, 'lib', 'versions.js'), path.join(destScriptsDir, 'lib'));

    // Make sure they are executable (sometimes zipping them can remove executable bit)
    shell.find(destScriptsDir).forEach(function (entry) {
        shell.chmod(755, entry);
    });
}

function detectProjectName (projectDir) {
    var files = fs.readdirSync(projectDir);
    for (var i = 0; i < files.length; ++i) {
        var m = /(.*)\.xcodeproj$/.exec(files[i]);
        if (m) {
            return m[1];
        }
    }
    throw new Error('Could not find an .xcodeproj directory within ' + projectDir);
}

function AbsParentPath (_path) {
    return path.resolve(path.dirname(_path));
}

function AbsProjectPath (relative_path) {
    var absolute_path = path.resolve(relative_path);
    if (/.pbxproj$/.test(absolute_path)) {
        absolute_path = AbsParentPath(absolute_path);
    } else if (!(/.xcodeproj$/.test(absolute_path))) {
        throw new Error('The following is not a valid path to an Xcode project' + absolute_path);
    }
    return absolute_path;
}

function relpath (_path, start) {
    start = start || process.cwd();
    return path.relative(path.resolve(start), path.resolve(_path));
}

/*
 * Creates a new OSX project with the following options:
 *
 * - --link (optional): Link directly against the shared copy of the CordovaLib instead of a copy of it
 * - --cli (optional): Use the CLI-project template
 * - <path_to_new_project>: Path to your new Cordova OSX project
 * - <package_name>: Package name, following reverse-domain style convention
 * - <project_name>: Project name
 * - <project_template_dir>: Path to a project template (override)
 *
 */
exports.createProject = function (project_path, package_name, project_name, opts, events) {
    package_name = package_name || 'my.cordova.project';
    project_name = project_name || 'CordovaExample';
    var use_shared = !!opts.link;
    var bin_dir = path.join(ROOT, 'bin');
    var project_parent = path.dirname(project_path);
    var project_template_dir = opts.customTemplate || path.join(bin_dir, 'templates', 'project');

    // check that project path doesn't exist
    if (fs.existsSync(project_path)) {
        return Promise.reject('Project already exists');
    }

    // check that parent directory does exist so cp -r will not fail
    if (!fs.existsSync(project_parent)) {
        return Promise.reject(project_parent + ' does not exist. Please specify an existing parent folder');
    }

    // create the project directory and copy over files
    shell.mkdir(project_path);
    shell.cp('-rf', path.join(project_template_dir, 'www'), project_path);
    shell.cp('-rf', path.join(project_template_dir, '__PROJECT_NAME__.xcodeproj'), project_path);
    shell.mv(path.join(project_path, '__PROJECT_NAME__.xcodeproj'), path.join(project_path, project_name + '.xcodeproj'));
    shell.cp('-rf', path.join(project_template_dir, '__PROJECT_NAME__'), project_path);
    shell.mv(path.join(project_path, '__PROJECT_NAME__'), path.join(project_path, project_name));

    var r = path.join(project_path, project_name);
    shell.mv(path.join(r, '__PROJECT_NAME__-Info.plist'), path.join(r, project_name + '-Info.plist'));
    shell.mv(path.join(r, '__PROJECT_NAME__-Prefix.pch'), path.join(r, project_name + '-Prefix.pch'));
    shell.mv(path.join(r, 'gitignore'), path.join(r, '.gitignore'));

    var project_name_esc = project_name.replace(/&/g, '\\&');
    shell.sed('-i', /__PROJECT_NAME__/g, project_name_esc, path.join(r + '.xcodeproj', 'project.pbxproj'));
    shell.sed('-i', /__PROJECT_NAME__/g, project_name_esc, path.join(r, 'Classes', 'AppDelegate.h'));
    shell.sed('-i', /__PROJECT_NAME__/g, project_name_esc, path.join(r, 'Classes', 'AppDelegate.m'));
    shell.sed('-i', /__PROJECT_NAME__/g, project_name_esc, path.join(r, 'Classes', 'MainViewController.h'));
    shell.sed('-i', /__PROJECT_NAME__/g, project_name_esc, path.join(r, 'Classes', 'MainViewController.m'));
    shell.sed('-i', /__PROJECT_NAME__/g, project_name_esc, path.join(r, 'MainViewController.xib'));
    shell.sed('-i', /__PROJECT_NAME__/g, project_name_esc, path.join(r, 'en.lproj/MainViewController.strings'));
    shell.sed('-i', /__PROJECT_NAME__/g, project_name_esc, path.join(r, 'main.m'));
    shell.sed('-i', /__PROJECT_NAME__/g, project_name_esc, path.join(r, project_name + '-Info.plist'));
    shell.sed('-i', /__PROJECT_NAME__/g, project_name_esc, path.join(r, project_name + '-Prefix.pch'));
    shell.sed('-i', /__PROJECT_NAME__/g, project_name_esc, path.join(r, 'config.xml'));
    shell.sed('-i', /--ID--/g, package_name, path.join(r, project_name + '-Info.plist'));

    // CordovaLib stuff
    copyJsAndCordovaLib(project_path, project_name, use_shared);
    copyScripts(project_path);

    events.emit('log', generateDoneMessage('create', use_shared));
    return Promise.resolve();
};

exports.updateProject = function (projectPath, opts, events) {
    var projectName = detectProjectName(projectPath);
    setShellFatal(true, function () {
        copyJsAndCordovaLib(projectPath, projectName, opts.link);
        copyScripts(projectPath);
        events.emit('log', generateDoneMessage('update', opts.link));
    });
    return Promise.resolve();
};

function generateDoneMessage (type, link) {
    var pkg = require('../../package');
    var msg = 'OS X project ' + (type === 'update' ? 'updated ' : 'created ') + 'with ' + pkg.name + '@' + pkg.version;
    if (link) {
        msg += ' and has a linked CordovaLib';
    }
    return msg;
}

function update_cordova_subproject (argv) {
    if (argv.length < 1 || argv.length > 2) {
        updateSubprojectHelp();
        throw new Error('Usage error for update_cordova_subproject');
    }

    var projectPath = AbsProjectPath(argv[0]);
    var cordovaLibXcodePath;
    if (argv.length < 2) {
        cordovaLibXcodePath = path.join(ROOT, 'CordovaLib', 'CordovaLib.xcodeproj');
    } else {
        cordovaLibXcodePath = AbsProjectPath(argv[1]);
    }

    var parentProjectPath = AbsParentPath(projectPath);
    var subprojectPath = relpath(cordovaLibXcodePath, parentProjectPath);
    var REGEX = /(.+PBXFileReference.+wrapper.pb-project.+)(path = .+?;)(.*)(sourceTree.+;)(.+)/;
    var newLine;
    var lines = shell.grep('CordovaLib.xcodeproj', path.join(projectPath, 'project.pbxproj'));
    var found = false;

    subprojectPath = subprojectPath.replace(/\\/g, '/');
    lines = lines.split('\n');
    for (var i = 0; i < lines.length; ++i) {
        if (lines[i].match(REGEX)) {
            found = true;
            /* eslint-disable no-useless-escape */
            newLine = lines[i].replace(/path = .+?;/, 'path = ' + subprojectPath + ';');
            newLine = newLine.replace(/sourceTree.+?;/, 'sourceTree = \"<group>\";');
            if (!newLine.match('name')) {
                newLine = newLine.replace('path = ', 'name = CordovaLib.xcodeproj; path = ');
            }
            shell.sed('-i', lines[i], newLine, path.join(projectPath, 'project.pbxproj'));
        }
    }

    // Patching pbxproj to replace copy www shell script with nodejs
    // Don't forget to duplicate this in templates/__CLI__.xcodeproj/project.pbxproj and templates/__PROJECT_NAME__.xcodeproj/project.pbxproj on later changes
    var copyWwwSh = 'cordova\/lib\/copy-www-build-step\.sh';
    var copyWwwJs = 'NODEJS_PATH=\/usr\/local\/bin; NVM_NODE_PATH=~\/\.nvm\/versions\/node\/`nvm version 2>\/dev\/null`\/bin; N_NODE_PATH=`find \/usr\/local\/n\/versions\/node\/\* -maxdepth 0 -type d 2>\/dev\/null \| tail -1`\/bin; XCODE_NODE_PATH=`xcode-select --print-path`\/usr\/share\/xcs\/Node\/bin; PATH=\$NODEJS_PATH:\$NVM_NODE_PATH:\$N_NODE_PATH:\$XCODE_NODE_PATH:\$PATH && node cordova\/lib\/copy-www-build-step\.js';
    shell.sed('-i', copyWwwSh, copyWwwJs, path.join(projectPath, 'project.pbxproj'));

    /* eslint-enable no-useless-escape */

    if (!found) {
        throw new Error('Subproject: ' + subprojectPath + ' entry not found in project file');
    }
}

exports.updateSubprojectHelp = updateSubprojectHelp;
exports.update_cordova_subproject = update_cordova_subproject;
