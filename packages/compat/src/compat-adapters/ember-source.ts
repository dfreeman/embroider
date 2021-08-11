import V1Addon from '../v1-addon';
import buildFunnel from 'broccoli-funnel';
import mergeTrees from 'broccoli-merge-trees';
import AddToTree from '../add-to-tree';
import { outputFileSync, unlinkSync } from 'fs-extra';
import { join } from 'path';
import semver from 'semver';
import walkSync from 'walk-sync';
import { Memoize } from 'typescript-memoize';

const pluginPath = require.resolve('../ember-source-imports-babel-plugin');
import type { Options as BabelPluginOptions } from '../ember-source-imports-babel-plugin';

export default class extends V1Addon {
  private useRealModules = semver.satisfies(this.packageJSON.version, '>=3.27.0-beta.0', { includePrerelease: true });

  @Memoize()
  get emberDependencyPaths() {
    let depsPath = join(this.root, 'dist/dependencies');
    return walkSync(depsPath, { globs: ['**/*.js'] });
  }

  get importPluginOptions(): BabelPluginOptions {
    return {
      dependenciesPath: join(this.root, 'dist/dependencies'),
      emberDependencyPaths: this.emberDependencyPaths,
    };
  }

  get options() {
    let o = super.options;
    if (!o.babel.plugins) {
      o.babel.plugins = [];
    }
    if (o.babel.plugins.find((p: any) => p[0] === pluginPath)) {
      return o;
    }

    o.babel.plugins.push([pluginPath, this.importPluginOptions]);

    return o;
  }

  get v2Tree() {
    return mergeTrees([super.v2Tree, buildFunnel(this.rootTree, { include: ['dist/ember-template-compiler.js'] })]);
  }

  // when using real modules, we're replacing treeForAddon and treeForVendor
  customizes(treeName: string) {
    return (
      (this.useRealModules && (treeName === 'treeForAddon' || treeName === 'treeForVendor')) ||
      super.customizes(treeName)
    );
  }

  invokeOriginalTreeFor(name: string, opts: { neuterPreprocessors: boolean } = { neuterPreprocessors: false }) {
    if (this.useRealModules) {
      if (name === 'addon') {
        return this.customAddonTree();
      }
      if (name === 'vendor') {
        return this.customVendorTree();
      }
    }
    return super.invokeOriginalTreeFor(name, opts);
  }

  // Our addon tree is all of the "packages" we share. @embroider/compat already
  // supports that pattern of emitting modules into other package's namespaces.
  private customAddonTree() {
    return mergeTrees([
      buildFunnel(this.rootTree, {
        srcDir: 'dist/packages',
      }),
      buildFunnel(this.rootTree, { srcDir: 'dist/dependencies', destDir: 'ember-source/dependencies' }),
    ]);
  }

  // We're zeroing out these files in vendor rather than deleting them, because
  // we can't easily intercept the `app.import` that presumably exists for them,
  // so rather than error they will just be empty.
  //
  // The reason we're zeroing these out is that we're going to consume all our
  // modules directly out of treeForAddon instead, as real modules that webpack
  // can see.
  private customVendorTree() {
    return new AddToTree(this.addonInstance._treeFor('vendor'), outputPath => {
      unlinkSync(join(outputPath, 'ember', 'ember.js'));
      outputFileSync(join(outputPath, 'ember', 'ember.js'), '');
      unlinkSync(join(outputPath, 'ember', 'ember-testing.js'));
      outputFileSync(join(outputPath, 'ember', 'ember-testing.js'), '');
    });
  }

  get packageMeta() {
    let meta = super.packageMeta;
    if (this.useRealModules) {
      if (!meta['implicit-modules']) {
        meta['implicit-modules'] = [];
      }
      meta['implicit-modules'].push('./ember/index.js');

      if (!meta['implicit-test-modules']) {
        meta['implicit-test-modules'] = [];
      }
      meta['implicit-test-modules'].push('./ember-testing/index.js');
    }
    return meta;
  }
}
