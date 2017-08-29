const {inspect} = require('util');
const fuse = require('fuse-bindings');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const mountPath = process.platform !== 'win32' ? './mnt' : 'M:\\';

const mednafenConfigInput = fs.createReadStream('/home/mike/.mednafen/mednafen-09x.cfg');
const mednafenConfigInterface = readline.createInterface(mednafenConfigInput);

const rootDirectory = {
  isDirectory: true,
  files: [],
  directories: []
};
const mednafenrcFile = {
  name: 'mednafenrc',
  isFile: true,
  parent: rootDirectory,
  lines: []
}
rootDirectory.files.push(mednafenrcFile);
const entries = new Map();
entries.set('/', rootDirectory);
entries.set('/mednafenrc', mednafenrcFile);

mednafenConfigInterface.on('line', parseMednafenConfigLine);
mednafenConfigInterface.on('close', () => mountFuse(entries));

function parseMednafenConfigLine(configLine) {
  if (isConfigLineAComment(configLine)) {
    return;
  } 

  if (isConfigLineEmpty(configLine)) {
    return;
  }

  const configLineRegex = /(.*?)\s(.*)/g;
  const regexResult = configLineRegex.exec(configLine);
  const settingPath = regexResult[1];
  const settingValue = regexResult[2];

  const settingPathRegex = /(.*)\.(.*)/g;
  const settingPathResult = settingPathRegex.exec(settingPath);

  if (!settingPathResult) {
    const newLine = {
      setting: settingPath,
      value: settingValue,
      wholeLine: `${settingPath} ${settingValue}\n`
    };
    mednafenrcFile.lines.push(newLine);
    return;
  }
  const directoriesPath = settingPathResult[1];
  const settingName = settingPathResult[2];

  const dirPath = convertDirPathToUnixPath(directoriesPath);
  const foundDirectories = getEachLevelOfDirPath(dirPath);

  foundDirectories.forEach(positionDirPathInDirectoriesMap);

  function positionDirPathInDirectoriesMap(dirPath, index, foundDirectories) {
    const isTheHighestLevelOfDirPath = index === foundDirectories.length - 1;

    let postfix = '';
    if (isTheHighestLevelOfDirPath) postfix = 'rc';
    const baseDir = path.dirname(dirPath);
    const baseName = path.basename(dirPath) + postfix;
    let fileName = dirPath + postfix;

    const parentObject = entries.get(baseDir);
    let currentObject = entries.get(fileName);
    
    let newEntry = {
      name: baseName
    };
    if (!currentObject) {
      if (!isTheHighestLevelOfDirPath) {
        Object.assign(newEntry, {
          isDirectory: true,
          directories: [],
          files: [],
        });
        parentObject.directories.push(newEntry);
      } else {
        Object.assign(newEntry, {
          isFile: true,
          lines: []
        });
        parentObject.files.push(newEntry);
      }
      currentObject = newEntry;
      entries.set(fileName, currentObject);
    }

    if (currentObject.isDirectory) return;

    const settingEntry = {
      setting: settingName,
      value: settingValue,
      wholeLine: `${settingName} ${settingValue}\n`
    };
    currentObject.lines.push(settingEntry);
  }
}


function convertDirPathToUnixPath(dirPath) {
  return `/${dirPath.split('.').join('/')}`;
}

function isConfigLineAComment(configLine) {
  return configLine[0] === ';';
}

function isConfigLineEmpty(configLine) {
  return configLine.length === 0 || !configLine.trim();
}

function getEachLevelOfDirPath(dirPath) {
  let separatorPosition = 0;
  const levelsArr = [];
  while (separatorPosition !== -1) {
    separatorPosition = dirPath.indexOf('/', separatorPosition + 1);
    let sliceEndPosition = separatorPosition;
    if (separatorPosition === -1) sliceEndPosition = dirPath.length; 
    const pathChunk = dirPath.slice(0, sliceEndPosition);
    levelsArr.push(pathChunk);
  }
  return levelsArr;
}

function mountFuse(fsTree) {
  fuse.mount(mountPath, {
    readdir: function (accessedPath, cb) {
      console.log('readdir(%s)', accessedPath);
      const foundPath = fsTree.get(accessedPath);
      if (foundPath && foundPath.isDirectory) {
        const tree = [];
        foundPath.directories.forEach(dir => tree.push(dir.name));
        foundPath.files.forEach(file => tree.push(file.name));
        return cb(0, tree);
      } 
      return cb(0);
    },
    getattr: function (accessedPath, cb) {
      const dirResponse = {
        mtime: new Date(),
        atime: new Date(),
        ctime: new Date(),
        size: 100,
        mode: 16877,
        uid: process.getuid ? process.getuid() : 0,
        gid: process.getgid ? process.getgid() : 0
      };
      const fileResponse = {
        mtime: new Date(),
        atime: new Date(),
        ctime: new Date(),
        size: 12,
        mode: 33188,
        uid: process.getuid ? process.getuid() : 0,
        gid: process.getgid ? process.getgid() : 0
      }
      console.log('getattr(%s)', accessedPath);
      const foundPath = entries.get(accessedPath);
      if (!foundPath) {
        return cb(fuse.ENOENT);
      } 

      if (foundPath.isDirectory) {
        return cb(0, dirResponse);
      }
      
      const wholeFile = [];
      foundPath.lines.forEach(line => wholeFile.push(line.wholeLine));
      Object.assign(fileResponse, {
        size: wholeFile.join('').length 
      })
      return cb(0, fileResponse);
    },
    open: function (accessedPath, flags, cb) {
      console.log('open(%s, %d)', accessedPath, flags);
      cb(0, 42); // 42 is an fd
    },
    read: function (accessedPath, fd, buf, len, pos, cb) {
      console.log('read(%s, %d, %d, %d)', accessedPath, fd, len, pos);
      const foundPath = fsTree.get(accessedPath);
      if (!foundPath || foundPath.isDirectory) return cb(0);

      const wholeFile = [];
      foundPath.lines.forEach(line => wholeFile.push(line.wholeLine));
      var str = wholeFile.join('').slice(pos, pos + len);
      if (!str) return cb(0);

      buf.write(str);
      return cb(str.length);
    }
  }, function (err) {
    if (err) throw err;
    console.log('filesystem mounted on ' + mountPath);
  })

  process.on('SIGINT', function () {
    fuse.unmount(mountPath, function (err) {
      if (err) {
        console.log('filesystem at ' + mountPath + ' not unmounted', err);
      } else {
        console.log('filesystem at ' + mountPath + ' unmounted');
      }
    });
  });
}
