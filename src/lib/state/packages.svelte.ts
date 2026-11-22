// The TeX distribution and its packages, for the package manager: what is
// installed, the catalog, and the tlmgr tasks with their log.

import { api, errorMessage, events, type Bundle, type InstallProgress, type Package, type TexStatus } from "$lib/api";
import { m } from "$lib/paraglide/messages";

const MAX_LOG_LINES = 500;

/** TeX distribution and package management. */
class PackageStore {
  status = $state<TexStatus | null>(null);
  catalog = $state.raw<Package[]>([]);
  catalogLoaded = $state(false);
  loadingCatalog = $state(false);
  /** Description of the running tlmgr task, `null` when idle. */
  task = $state<string | null>(null);
  progress = $state<InstallProgress | null>(null);
  log = $state.raw<string[]>([]);
  error = $state<string | null>(null);

  installed = $derived(this.status?.installed ?? false);
  busy = $derived(this.task !== null);
  /** `updateAll` is running: install progress then means a new TeX Live year. */
  #updating = false;

  async init() {
    await events.onTexLog((line) => this.#appendLog(line));
    await events.onInstallProgress((p) => {
      this.progress = p;
      // An update that turned into installing a new TeX Live year says so.
      if (this.#updating && this.task === m.task_update_all()) this.task = m.task_upgrade_release();
    });
    await this.refreshStatus();
  }

  async refreshStatus() {
    this.status = await api.texStatus();
  }

  async loadCatalog() {
    if (!this.installed || this.loadingCatalog) return;
    this.loadingCatalog = true;
    this.error = null;
    try {
      this.catalog = await api.packagesList(true);
    } catch (err) {
      // Offline: fall back to the locally installed packages.
      this.error = m.error_catalog_offline({ error: errorMessage(err) });
      this.catalog = await api.packagesList(false).catch(() => []);
    } finally {
      this.catalogLoaded = true;
      this.loadingCatalog = false;
    }
  }

  installDistribution(bundle: Bundle) {
    return this.#run(m.task_install_distribution(), async () => {
      this.progress = null;
      await api.texInstall(bundle);
      await this.refreshStatus();
      this.catalogLoaded = false;
      await this.loadCatalog();
    });
  }

  uninstallDistribution() {
    return this.#run(m.task_uninstall_distribution(), async () => {
      await api.texUninstall();
      await this.refreshStatus();
      this.catalog = [];
      this.catalogLoaded = false;
    });
  }

  install(names: string[]) {
    return this.#run(m.task_install({ names: names.join(", ") }), async () => {
      await api.packagesInstall(names);
      this.#markInstalled(names, true);
    });
  }

  remove(names: string[]) {
    return this.#run(m.task_remove({ names: names.join(", ") }), async () => {
      await api.packagesRemove(names);
      this.#markInstalled(names, false);
    });
  }

  /**
   * Updates everything. After a new TeX Live year the backend installs TinyTeX
   * anew and puts the packages back; its download then shows as during setup.
   */
  updateAll() {
    return this.#run(m.task_update_all(), async () => {
      this.progress = null;
      this.#updating = true;
      try {
        const reinstalled = await api.packagesUpdateAll();
        if (!reinstalled) return;
        await this.refreshStatus();
        this.catalogLoaded = false;
        await this.loadCatalog();
      } finally {
        this.#updating = false;
        this.progress = null;
      }
    });
  }

  /** Finds and installs the package providing `file`; returns its name. */
  installForFile(file: string) {
    return this.#run(m.task_find_package({ file }), async () => {
      const [name] = await api.packagesForFile(file);
      if (!name) throw new Error(m.error_no_package_for_file({ file }));
      this.task = m.task_install({ names: name });
      await api.packagesInstall([name]);
      this.#markInstalled([name], true);
      return name;
    });
  }

  clearLog() {
    this.log = [];
  }

  async #run<T>(task: string, action: () => Promise<T>): Promise<T | undefined> {
    if (this.task) return;
    this.task = task;
    this.error = null;
    this.#appendLog(`▶ ${task}`);
    try {
      return await action();
    } catch (err) {
      this.error = errorMessage(err);
      this.#appendLog(`✖ ${this.error}`);
    } finally {
      this.task = null;
    }
  }

  #markInstalled(names: string[], installed: boolean) {
    this.catalog = this.catalog.map((p) => (names.includes(p.name) ? { ...p, installed } : p));
  }

  #appendLog(line: string) {
    this.log = [...this.log, line].slice(-MAX_LOG_LINES);
  }
}

export const packages = new PackageStore();
