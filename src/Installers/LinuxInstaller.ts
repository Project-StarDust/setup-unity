import { Installer } from './installer_definition';
import { GetId } from '../utility';
import { exec } from '@actions/exec';
import * as cp from 'child_process';
import { getCacheEntry, downloadCache, saveCache } from '../cacheHttpClient';
import * as io from '@actions/io';
import { HttpClient } from 'typed-rest-client/HttpClient';
import * as fs from 'fs';
import { info, getInput } from '@actions/core';
import { GetCacheKeyVersionIndex, GetCacheKeyCount } from './cache_version';

export class LinuxInstaller implements Installer {
    version: string | undefined;
    id: string | undefined;
    GetId(version: string): string {
        if (this.version === version) {
            if (this.id)
                return this.id;
            return this.id = GetId(version);
        }
        this.version = version;
        return this.id = GetId(version);
    };
    async ExecuteSetUp(version: string): Promise<void> {
        if (getInput('enable-cache', { required: false }) == 'true') {
            if (await this.TryRestore(version)) { return; }
            this.Install(version);
            await this.TrySave(version);
        }
        else {
            this.Install(version);
        }
    };
    async Install(version: string) {
        const download_url: string = "https://beta.unity3d.com/download/" + GetId(version) + "/UnitySetup";
        await exec('sudo apt-get update');
        cp.execSync('sudo apt-get -y install gconf-service');
        cp.execSync('sudo apt-get -y install lib32gcc1');
        cp.execSync('sudo apt-get -y install lib32stdc++6');
        cp.execSync('sudo apt-get -y install libasound2');
        cp.execSync('sudo apt-get -y install libc6');
        cp.execSync('sudo apt-get -y install libc6-i386');
        cp.execSync('sudo apt-get -y install libcairo2');
        cp.execSync('sudo apt-get -y install libcap2');
        cp.execSync('sudo apt-get -y install libcups2');
        cp.execSync('sudo apt-get -y install libdbus-1-3');
        cp.execSync('sudo apt-get -y install libexpat1');
        cp.execSync('sudo apt-get -y install libfontconfig1');
        cp.execSync('sudo apt-get -y install libfreetype6');
        cp.execSync('sudo apt-get -y install libgcc1');
        cp.execSync('sudo apt-get -y install libgconf-2-4');
        cp.execSync('sudo apt-get -y install libgdk-pixbuf2.0-0');
        cp.execSync('sudo apt-get -y install libgl1-mesa-glx');
        cp.execSync('sudo apt-get -y install libglib2.0-0');
        cp.execSync('sudo apt-get -y install libglu1-mesa');
        cp.execSync('sudo apt-get -y install libgtk2.0-0');
        cp.execSync('sudo apt-get -y install libnspr4');
        cp.execSync('sudo apt-get -y install libnss3');
        cp.execSync('sudo apt-get -y install libpango1.0-0');
        cp.execSync('sudo apt-get -y install libstdc++6');
        cp.execSync('sudo apt-get -y install libx11-6');
        cp.execSync('sudo apt-get -y install libxcomposite1');
        cp.execSync('sudo apt-get -y install libxcursor1');
        cp.execSync('sudo apt-get -y install libxdamage1');
        cp.execSync('sudo apt-get -y install libxext6');
        cp.execSync('sudo apt-get -y install libxfixes3');
        cp.execSync('sudo apt-get -y install libxi6');
        cp.execSync('sudo apt-get -y install libxrandr2');
        cp.execSync('sudo apt-get -y install libxrender1');
        cp.execSync('sudo apt-get -y install libxtst6');
        cp.execSync('sudo apt-get -y install zlib1g');
        cp.execSync('sudo apt-get -y install npm');
        cp.execSync('sudo apt-get -y install debconf');
        //cp.execSync('sudo apt-get -y install libpq5');
        await exec('wget ' + download_url + ' -O UnitySetUp');
        await exec('sudo chmod +x UnitySetUp');
        cp.execSync('echo y | ./UnitySetUp --unattended --install-location="/opt/Unity-' + version + '"');
        await exec('mv /opt/Unity-' + version + '/ /opt/Unity/');
        await exec('sudo rm -f UnitySetUp');
    };
    async TryRestore(version: string): Promise<boolean> {
        const mkdirPromise = io.mkdirP('/opt/Unity/Editor/' + version);
        try {
            const cacheEntry = await getCacheEntry([GetCacheKeyCount(version)]);
            if (!cacheEntry) {
                return false;
            }
            const httpClient = new HttpClient("actions/cache");
            const split_count = Number.parseInt(await (await httpClient.get(cacheEntry.archiveLocation!)).readBody());
            const archiveFilePromises: Promise<void>[] = new Array(split_count);
            await mkdirPromise;
            for (let index = 0; index < split_count; index++) {
                const entryPromise = getCacheEntry([GetCacheKeyVersionIndex(version, index)]);
                archiveFilePromises[index] = entryPromise.then(async (entry) => {
                    if (!entry) throw "null entry";
                    return await downloadCache(entry, '/opt/Unity/Editor/' + version + '/unity.tar.7z' + index);
                });
            }
            Promise.all(archiveFilePromises);
        } catch (error) {
            return false;
        }

        cp.execSync('cat /opt/Unity/Editor/' + version + '/unity.tar.7z.* > /opt/Unity/Editor/' + version + '/all.tar.7z');
        await exec('rm -f /opt/Unity/Editor/' + version + '/unity.tar.7z.*');
        cp.execSync('cd /opt/Unity && 7z x ./Editor/' + version + '/all.tar.7z -so | tar xf -');
        await io.rmRF('/opt/Unity/Editor/' + version);
        return true;
    };
    async TrySave(version: string): Promise<void> {
        cp.execSync('cd /opt/Unity/ && tar cf unity.tar *');
        await exec('mv -f /opt/Unity/unity.tar ./unity.tar');
        await exec('7z a unity.tar.7z unity.tar');
        const tar7z = fs.statSync('unity.tar.7z');
        const splitSize = 1024 * 1024 * 400;
        const split_count = Math.ceil(tar7z.size / splitSize);
        const promises: Promise<void>[] = new Array(split_count + 1);
        cp.execSync('echo -n ' + split_count + ' > unitytar7zcount');
        promises[split_count] = saveCache(fs.createReadStream('unitytar7zcount'), GetCacheKeyCount(version));
        for (let index = 0; index < split_count; index++) {
            const stream = fs.createReadStream('unity.tar.7z', {
                start: index * splitSize,
                end: (index + 1) * splitSize - 1,
            });
            promises[index] = saveCache(stream, GetCacheKeyVersionIndex(version, index));
        }
        info('Issue all save cache');
        return Promise.all(promises).then(async (_) => {
            await exec('rm -f unity.tar.7z unity.tar unitytar7zcount');
        });
    }
}