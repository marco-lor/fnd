#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const { ensureDirectory, frontendRoot, resultsDir, writeJson } = require('./common');

process.env.BABEL_ENV = 'production';
process.env.NODE_ENV = 'production';
process.env.GENERATE_SOURCEMAP = 'false';

const temporaryOutput = path.join(frontendRoot, '.perf-webpack-stats-build');
fs.rmSync(temporaryOutput, { recursive: true, force: true });

const configFactory = require('react-scripts/config/webpack.config');
const config = configFactory('production');
config.devtool = false;
config.output = { ...config.output, path: temporaryOutput };

const compiler = webpack(config);
compiler.run((error, stats) => {
  const finish = (exitCode) => {
    compiler.close(() => {
      fs.rmSync(temporaryOutput, { recursive: true, force: true });
      process.exitCode = exitCode;
    });
  };

  if (error) {
    console.error(error);
    finish(1);
    return;
  }
  if (stats.hasErrors()) {
    console.error(stats.toString({ colors: false, all: false, errors: true, errorDetails: true }));
    finish(1);
    return;
  }

  const json = stats.toJson({
    all: false,
    assets: true,
    chunks: true,
    chunkGroups: true,
    chunkModules: true,
    ids: true,
    modules: true,
    nestedModules: true,
  });
  ensureDirectory(resultsDir);
  writeJson(path.join(resultsDir, 'webpack-stats.json'), json);
  finish(0);
});

