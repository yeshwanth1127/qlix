import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDockerRunArgs } from './dockerClient.js';

test('cloud runner docker args enforce the hardened sandbox', () => {
  const args = buildDockerRunArgs({
    name: 'runner-test',
    imageRef: 'qlix-cloud-runner:test',
    user: '10001:10001',
    readOnlyRoot: true,
    dropAllCapabilities: true,
    noNewPrivileges: true,
    tmpfs: [
      { containerPath: '/tmp', options: 'rw,nosuid,nodev,noexec,size=512m,mode=1777' },
      { containerPath: '/home/qlix', options: 'rw,nosuid,nodev,size=128m,uid=10001,gid=10001,mode=0700' },
    ],
  });

  assert.deepEqual(args.slice(0, 17), [
    'run', '-d', '--restart', 'unless-stopped', '--name', 'runner-test',
    '--user', '10001:10001',
    '--read-only',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true',
    '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=512m,mode=1777',
    '--tmpfs', '/home/qlix:rw,nosuid,nodev,size=128m,uid=10001,gid=10001,mode=0700',
  ]);
  assert.equal(args.at(-1), 'qlix-cloud-runner:test');
});
