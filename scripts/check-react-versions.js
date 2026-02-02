#!/usr/bin/env node
/**
 * Pre-install script to ensure React and React-DOM versions match.
 * This prevents the fatal "Incompatible React versions" error in Next.js 15+.
 * 
 * Run automatically via npm preinstall hook.
 */

const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '..', 'package.json');

try {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  const reactVersion = packageJson.dependencies?.react;
  const reactDomVersion = packageJson.dependencies?.['react-dom'];
  const overrideReact = packageJson.overrides?.react;
  const overrideReactDom = packageJson.overrides?.['react-dom'];
  const typesReact = packageJson.devDependencies?.['@types/react'];
  const typesReactDom = packageJson.devDependencies?.['@types/react-dom'];
  const overrideTypesReact = packageJson.overrides?.['@types/react'];
  const overrideTypesReactDom = packageJson.overrides?.['@types/react-dom'];
  
  const errors = [];
  const warnings = [];
  
  // Check if react and react-dom versions match in dependencies
  if (reactVersion !== reactDomVersion) {
    errors.push(`MISMATCH: react (${reactVersion}) !== react-dom (${reactDomVersion})`);
  }
  
  // Check if overrides exist and match
  if (!overrideReact || !overrideReactDom) {
    errors.push('MISSING: overrides for react/react-dom are required');
  } else if (overrideReact !== overrideReactDom) {
    errors.push(`MISMATCH in overrides: react (${overrideReact}) !== react-dom (${overrideReactDom})`);
  }
  
  // Check that dependencies match overrides
  if (overrideReact && reactVersion !== overrideReact) {
    errors.push(`MISMATCH: dependency react (${reactVersion}) !== override (${overrideReact})`);
  }
  
  // Check @types/react overrides match devDependencies
  if (typesReact && overrideTypesReact && typesReact !== overrideTypesReact) {
    warnings.push(`@types/react mismatch: devDep (${typesReact}) !== override (${overrideTypesReact})`);
  }
  
  // Check for caret/tilde ranges (should be exact versions)
  if (reactVersion && (reactVersion.startsWith('^') || reactVersion.startsWith('~'))) {
    errors.push(`WARNING: react version "${reactVersion}" uses a range. Use exact version to prevent drift.`);
  }
  if (reactDomVersion && (reactDomVersion.startsWith('^') || reactDomVersion.startsWith('~'))) {
    errors.push(`WARNING: react-dom version "${reactDomVersion}" uses a range. Use exact version to prevent drift.`);
  }
  
  if (warnings.length > 0) {
    console.warn('\n[check-react-versions] Warnings:');
    warnings.forEach(w => console.warn('  ⚠ ' + w));
  }
  
  if (errors.length > 0) {
    console.error('\n========================================');
    console.error('  REACT VERSION CHECK FAILED');
    console.error('========================================\n');
    errors.forEach(err => console.error('  ✗ ' + err));
    console.error('\n  React and React-DOM MUST have identical exact versions.');
    console.error('  This is required for Next.js 15+ compatibility.\n');
    console.error('  To fix: Ensure package.json has matching versions:');
    console.error('    "react": "19.2.0",');
    console.error('    "react-dom": "19.2.0",');
    console.error('    "overrides": { "react": "19.2.0", "react-dom": "19.2.0" }');
    console.error('\n========================================\n');
    process.exit(1);
  }
  
  console.log('✓ React version check passed: react@' + reactVersion + ' === react-dom@' + reactDomVersion);
  
} catch (error) {
  console.error('Error checking React versions:', error.message);
  process.exit(1);
}
