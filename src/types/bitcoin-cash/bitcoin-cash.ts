import { Bitcoin } from '../bitcoin/bitcoin';
import { defaultDockerNetwork, NetworkType, NodeClient, NodeType } from '../../constants';
import { v4 as uuid } from 'uuid';
import { generateRandom } from '../../util';
import { CryptoNodeData, VersionDockerImage } from '../../interfaces/crypto-node';
import { Docker } from '../../util/docker';
import { ChildProcess } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';

const coreConfig = `
server=1
listen=1
txindex=1
[{{NETWORK}}]
datadir=/opt/blockchain-data
walletdir=/opt/blockchain-wallets
rpcuser={{RPC_USERNAME}}
rpcpassword={{RPC_PASSWORD}}
rpcallowip=0.0.0.0/0
rpcbind=0.0.0.0
port={{PEER_PORT}}
rpcport={{RPC_PORT}}
`;

export class BitcoinCash extends Bitcoin {

  static versions(client = BitcoinCash.clients[0]): VersionDockerImage[] {
    client = client || BitcoinCash.clients[0];
    switch(client) {
      case NodeClient.CORE:
        return [
          {
            version: '23.0.0',
            image: 'zquestz/bitcoin-cash-node:23.0.0',
            dataDir: '/opt/blockchain-data',
            walletDir: '/opt/blockchain-wallets',
            configPath: '/opt/bitcoincash.conf',
            generateRuntimeArgs(data: CryptoNodeData): string {
              return ` -conf=${this.configPath}` + (data.network === NetworkType.TESTNET ? ' -testnet' : '');
            },
          },
        ];
      default:
        return [];
    }
  }

  static clients = [
    NodeClient.CORE,
  ];

  static nodeTypes = [
    NodeType.FULL,
  ];

  static networkTypes = [
    NetworkType.MAINNET,
    NetworkType.TESTNET,
  ];

  static defaultRPCPort = {
    [NetworkType.MAINNET]: 10332,
    [NetworkType.TESTNET]: 11332,
  };

  static defaultPeerPort = {
    [NetworkType.MAINNET]: 10333,
    [NetworkType.TESTNET]: 11333,
  };

  static generateConfig(client = BitcoinCash.clients[0], network = NetworkType.MAINNET, peerPort = BitcoinCash.defaultPeerPort[NetworkType.MAINNET], rpcPort = BitcoinCash.defaultRPCPort[NetworkType.MAINNET], rpcUsername = generateRandom(), rpcPassword = generateRandom()): string {
    switch(client) {
      case NodeClient.CORE:
        return coreConfig
          .replace('{{NETWORK}}', network === NetworkType.MAINNET ? 'main' : 'test')
          .replace('{{RPC_USERNAME}}', rpcUsername)
          .replace('{{RPC_PASSWORD}}', rpcPassword)
          .replace('{{PEER_PORT}}', peerPort.toString(10))
          .replace('{{RPC_PORT}}', rpcPort.toString(10))
          .trim();
      default:
        return '';
    }
  }

  id: string;
  ticker = 'bch';
  version: string;
  dockerImage: string;
  network: string;
  peerPort: number;
  rpcPort: number;
  rpcUsername: string;
  rpcPassword: string;
  client: string;
  dockerCpus = 4;
  dockerMem = 4096;
  dockerNetwork = defaultDockerNetwork;
  dataDir = '';
  walletDir = '';
  configPath = '';

  constructor(data: CryptoNodeData, docker?: Docker, logInfo?: (message: string)=>void, logError?: (message: string)=>void) {
    super(data, docker, logInfo, logError);
    this.id = data.id || uuid();
    this.network = data.network || NetworkType.MAINNET;
    this.peerPort = data.peerPort || BitcoinCash.defaultPeerPort[this.network];
    this.rpcPort = data.rpcPort || BitcoinCash.defaultRPCPort[this.network];
    this.rpcUsername = data.rpcUsername || generateRandom();
    this.rpcPassword = data.rpcPassword || generateRandom();
    this.client = data.client || BitcoinCash.clients[0];
    this.dockerCpus = data.dockerCpus || this.dockerCpus;
    this.dockerMem = data.dockerMem || this.dockerMem;
    this.dockerNetwork = data.dockerNetwork || this.dockerNetwork;
    this.dataDir = data.dataDir || this.dataDir;
    this.walletDir = data.walletDir || this.dataDir;
    this.configPath = data.configPath || this.configPath;
    this.version = data.version || BitcoinCash.versions(this.client)[0].version;
    this.dockerImage = data.dockerImage || BitcoinCash.versions(this.client)[0].image;
    if(docker)
      this._docker = docker;
    if(logError)
      this._logError = logError;
    if(logInfo)
      this._logInfo = logInfo;
  }

  async start(onOutput?: (output: string)=>void, onError?: (err: Error)=>void): Promise<ChildProcess> {
    const versionData = BitcoinCash.versions(this.client).find(({ version }) => version === this.version);
    if(!versionData)
      throw new Error(`Unknown version ${this.version}`);
    const {
      dataDir: containerDataDir,
      walletDir: containerWalletDir,
      configPath: containerConfigPath,
    } = versionData;
    let args = [
      '-i',
      '--rm',
      '--memory', this.dockerMem.toString(10) + 'MB',
      '--cpus', this.dockerCpus.toString(10),
      '--name', this.id,
      '--network', this.dockerNetwork,
      '-p', `${this.rpcPort}:${this.rpcPort}`,
      '-p', `${this.peerPort}:${this.peerPort}`,
      '--entrypoint', 'bitcoind',
    ];
    const tmpdir = os.tmpdir();
    const dataDir = this.dataDir || path.join(tmpdir, uuid());
    args = [...args, '-v', `${dataDir}:${containerDataDir}`];
    await fs.ensureDir(dataDir);

    const walletDir = this.walletDir || path.join(tmpdir, uuid());
    args = [...args, '-v', `${walletDir}:${containerWalletDir}`];
    await fs.ensureDir(walletDir);

    const configPath = this.configPath || path.join(tmpdir, uuid());
    const configExists = await fs.pathExists(configPath);
    if(!configExists)
      await fs.writeFile(configPath, this.generateConfig(), 'utf8');
    args = [...args, '-v', `${configPath}:${containerConfigPath}`];

    await this._docker.createNetwork(this.dockerNetwork);
    const instance = this._docker.run(
      this.dockerImage + versionData.generateRuntimeArgs(this),
      args,
      onOutput ? onOutput : ()=>{},
      onError ? onError : ()=>{},
    );
    this._instance = instance;
    return instance;
  }

  generateConfig(): string {
    return BitcoinCash.generateConfig(
      this.client,
      this.network,
      this.peerPort,
      this.rpcPort,
      this.rpcUsername,
      this.rpcPassword);
  }

}
