import type { HubConnectorFactory, HubConnectorHandle, HubConnectorOptions, HubConnectorStatus } from "./connector.ts"

export class MockHubConnector implements HubConnectorHandle {
  private _started = false
  private _status: HubConnectorStatus = { connected: false }

  constructor(private readonly options: HubConnectorOptions) {}

  get started(): boolean { return this._started }
  start(): void { this._started = true }
  getStatus(): HubConnectorStatus { return this._status }
  setStatus(status: HubConnectorStatus): void { this._status = status }
  stop(): void { this._started = false }
}

export class MockHubConnectorFactory implements HubConnectorFactory {
  instances: MockHubConnector[] = []
  start(options: HubConnectorOptions): HubConnectorHandle {
    const connector = new MockHubConnector(options)
    this.instances.push(connector)
    connector.start()
    return connector
  }
}
