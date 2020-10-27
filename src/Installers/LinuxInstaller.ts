import { Installer, InstallOption } from './installer_definition';
import { GetId } from '../utility';
import { exec } from '@actions/exec';
import * as cp from 'child_process';
import { getCacheEntry, downloadCache, saveCache } from '../cacheHttpClient';
import * as io from '@actions/io';
import { HttpClient } from 'typed-rest-client/HttpClient';
import * as fs from 'fs';
import { info, getInput } from '@actions/core';
import { GetCacheKeyVersionIndex, GetCacheKeyCount } from './cache_version';

const PACKAGES = [
    "gconf-service",
    "lib32gcc1",
    "lib32stdc++6",
    "libasound2",
    "libc6",
    "libc6-i386",
    "libcairo2",
    "libcap2",
    "libcups2",
    "libdbus-1-3",
    "libexpat1",
    "libfontconfig1",
    "libfreetype6",
    "libgcc1",
    "libgconf-2-4",
    "libgdk-pixbuf2.0-0",
    "libgl1-mesa-glx",
    "libglib2.0-0",
    "libglu1-mesa",
    "libgtk2.0-0",
    "libnspr4",
    "libnss3",
    "libpango1.0-0",
    "libstdc++6",
    "libx11-6",
    "libxcomposite1",
    "libxcursor1",
    "libxdamage1",
    "libxext6",
    "libxfixes3",
    "libxi6",
    "libxrandr2",
    "libxrender1",
    "libxtst6",
    "zlib1g",
    "nodejs-dev",
    "node-gyp",
    "libssl1.0-dev",
    "npm",
    "debconf",
];

export class LinuxInstaller implements Installer {
    constructor() {
        this.key = 'll';
    }
    version: string | undefined;
    id: string | undefined;
    private key: string;
    GetId(version: string): string {
        if (this.version === version) {
            if (this.id)
                return this.id;
            return this.id = GetId(version);
        }
        this.version = version;
        return this.id = GetId(version);
    };
    async ExecuteSetUp(version: string, option: InstallOption): Promise<void> {
        const inst_dep = getInput('install-dependencies', { required: false });

        if (!inst_dep || inst_dep == 'true') {
            await this.InstallDependencies();
        }
        if (getInput('enable-cache', { required: false }) == 'true') {
            if (await this.TryRestore(version)) { return; }
            await this.Install(version, option);
            await this.TrySave(version);
        }
        else {
            await this.Install(version, option);
        }
    };
    private async InstallDependencies(): Promise<void> {
        exec('sudo apt-get update').then(
            _ => exec(`sudo apt-get install -y ${PACKAGES.join(" ")}`)
        )
    };
    private async Install(version: string, option: InstallOption) {
        const download_url: string = "https://beta.unity3d.com/download/" + GetId(version) + "/UnitySetup";
        await exec('wget ' + download_url + ' -O UnitySetUp');
        await exec('sudo chmod +x UnitySetUp');
        let command = this.CreateInstallCommand(option);
        cp.execSync(command);
    };
    private CreateInstallCommand(option: InstallOption) {
        let command = 'echo y | ./UnitySetUp --unattended --install-location="/opt/Unity" --components="Unity';
        if (option["has-android"] === 'true') {
            command += ',Android';
        }
        if (option["has-il2cpp"] === 'true') {
            command += ',Linux-IL2CPP';
        }
        if (option["has-ios"] === 'true') {
            command += ',iOS';
        }
        if (option["has-mac-mono"] === 'true') {
            command += ',Mac-Mono';
        }
        if (option["has-webgl"] === 'true') {
            command += ',WebGL';
        }
        if (option["has-windows-mono"] === 'true') {
            command += ',Windows-Mono';
        }
        command += '"';
        return command;
    }

    private async TryRestore(version: string): Promise<boolean> {
        const mkdirPromise = io.mkdirP('/opt/Unity/');
        try {
            const cacheEntry = await getCacheEntry([GetCacheKeyCount(this.key, version)]);
            if (!cacheEntry) {
                return false;
            }
            const httpClient = new HttpClient("actions/cache");
            const split_count = Number.parseInt(await (await httpClient.get(cacheEntry.archiveLocation!)).readBody());
            const archiveFilePromises: Promise<void>[] = new Array(split_count);
            await mkdirPromise;
            for (let index = 0; index < split_count; index++) {
                const entryPromise = getCacheEntry([GetCacheKeyVersionIndex(this.key, version, index)]);
                archiveFilePromises[index] = entryPromise.then(async (entry) => {
                    if (!entry) throw "null entry";
                    return await downloadCache(entry, 'unity.tar.7z' + index);
                });
            }
            Promise.all(archiveFilePromises);
        } catch (error) {
            return false;
        }

        cp.execSync('cat unity.tar.7z* > all.tar.7z');
        await exec('7z x all.tar.7z -o/opt/Unity/all.tar');
        cp.execSync('cd /opt/Unity/ && tar xf all.tar')
        await exec('rm -f unity.tar.7z* all.tar.7z /opt/Unity/all.tar');
        // cp.execSync('rm -rf /opt/Unity/ && mv -T /opt/Unity-' + version + ' /opt/Unity/');
        return true;
    };
    private async TrySave(version: string): Promise<void> {
        cp.execSync('cd /opt/Unity/ && tar cf unity.tar *');
        await exec('mv -f /opt/Unity/unity.tar ./unity.tar');
        await exec('7z a unity.tar.7z unity.tar');
        const tar7z = fs.statSync('unity.tar.7z');
        const splitSize = 1024 * 1024 * 400;
        const split_count = Math.ceil(tar7z.size / splitSize);
        const promises: Promise<void>[] = new Array(split_count + 1);
        cp.execSync('echo -n ' + split_count + ' > unitytar7zcount');
        promises[split_count] = saveCache(fs.createReadStream('unitytar7zcount'), GetCacheKeyCount(this.key, version));
        for (let index = 0; index < split_count; index++) {
            const stream = fs.createReadStream('unity.tar.7z', {
                start: index * splitSize,
                end: (index + 1) * splitSize - 1,
            });
            promises[index] = saveCache(stream, GetCacheKeyVersionIndex(this.key, version, index));
        }
        info('Issue all save cache');
        return Promise.all(promises).then(async (_) => {
            await exec('rm -f unity.tar.7z unity.tar unitytar7zcount');
        });
    }
}