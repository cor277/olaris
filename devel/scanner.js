// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

const nuv = require('nuv');

// *** Utility functions ***

const isSingleFileAction = (package, entry) => !nuv.isDir(nuv.joinPath(package, entry));

// TODO: check for package.json, go.mod, requirements.txt, pom.xml
const isMultiFileAction = (package, entry) => nuv.isDir(nuv.joinPath(package, entry));

const supportedRuntimes = [".js", ".py", ".go", ".java"];
const isSupportedRuntime = (file) => supportedRuntimes.includes(nuv.fileExt(file));

// Get the action name from the file name: "/path/to/action.js" -> "action"
function getActionName(path) {
    const basePath = nuv.basePath(path);
    const ext = nuv.fileExt(basePath)
    return basePath.substring(0, basePath.length - ext.length);
}

// *** Main ***
main();

function main() {
    let path = process.argv[2];

    let manifest = scanPackages(path);

    manifest = scanEnvfile(path, manifest);

    let manifestYaml = nuv.toYaml(manifest);

    const manifestPath = nuv.joinPath(process.env.NUV_TMP, "manifest.yml");

    nuv.writeFile(manifestPath, manifestYaml);
    console.log("Manifest file written at " + manifestPath);
}

function scanEnvfile(path, manifest) {
    const envfilePath = nuv.joinPath(path, '.env');

    // for each line in the envfile
    // add in each package the env variables

    if (!nuv.exists(envfilePath)) {
        return manifest;
    }

    console.log('Scanning .env file...');

    const envfile = nuv.readFile(envfilePath);
    const lines = envfile.split('\n');
    lines.forEach(function (line) {
        const parts = line.split('=');
        if (parts.length == 2) {
            const key = parts[0];
            const value = parts[1];
            for (const packageName in manifest.packages) {
                if (!manifest.packages[packageName].env) {
                    manifest.packages[packageName].env = {};
                }
                manifest.packages[packageName].env[key] = value;
            }
        }
    });

    return manifest;
}

function scanPackages(path) {
    manifest = { packages: {} };
    const packagesPath = nuv.joinPath(path, '/packages');
    if (!nuv.exists(packagesPath)) {
        return manifest;
    }

    console.log('Scanning packages folder...');
    nuv.readDir(packagesPath).forEach(function (entry) {
        const packagePath = nuv.joinPath(packagesPath, entry);
        // if it's a directory, it's an ow package
        if (nuv.isDir(packagePath)) {
            // check we are not overwriting the default package
            if (entry != 'default' || (entry == 'default' && !manifest.packages['default'])) {
                manifest.packages[entry] = { actions: {} };
            }
            scanSinglePackage(manifest, packagePath);
        } else {// otherwise it could be a single file action in the default package
            if (isSupportedRuntime(entry)) {
                // console.log(entry + ' is supported single file action in default package');
                const actionName = getActionName(entry);
                // add 'default' package if not present
                if (!manifest.packages['default']) {
                    manifest.packages['default'] = { actions: {} };
                }
                manifest.packages['default'].actions[actionName] = { function: packagePath, web: true };
            }
        }
    });
    console.log('Packages scanned');
    return manifest;
}

function scanSinglePackage(manifest, packagePath) {
    const packageName = nuv.basePath(packagePath);
    // console.log('Scanning package ' + packageName);
    nuv.readDir(packagePath).forEach(function (entry) {
        // console.log('Scanning ' + packageName + '/' + entry);
        // if the ext is .zip it's probably an old zip action
        if (nuv.fileExt(entry) == '.zip') {
            return;
        }

        if (isSingleFileAction(packagePath, entry) && isSupportedRuntime(entry)) {
            // console.log(packageName + '/' + entry + ' is supported single file action');
            const actionName = getActionName(entry);
            manifest.packages[packageName].actions[actionName] = { function: nuv.joinPath(packagePath, entry), web: true };
        } else if (isMultiFileAction(packagePath, entry)) {
            const actionName = getActionName(entry);
            // console.log(packageName + '/' + entry + ' is multi file action');
            let res = nuv.nuvExec('-zipf', nuv.joinPath(packagePath, entry));

            // nuv -zipf prints the path of the zip file to stdout
            // so if the result doesn't end with .zip\n, it's an error
            if (!res.endsWith('.zip\n')) {
                console.error("ZIP ERROR:", res)
                return;
            }

            const functionEntry = nuv.basePath(res.split(" ")[2]).trim();
            manifest.packages[packageName].actions[actionName] = { function: nuv.joinPath(packagePath, functionEntry), web: true };
        }

    });
}
