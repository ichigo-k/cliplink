// Monorepo setup: Metro must watch the workspace root so `@cliplink/crypto` and
// `@cliplink/protocol` resolve to their TypeScript sources rather than failing.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Without this, Metro walks up and can resolve two copies of React.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
