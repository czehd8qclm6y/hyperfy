import { readPacket, writePacket } from '../packets'
import { System } from './System'

/**
 * Client Network System
 *
 * - runs on the client
 * - provides abstract network methods matching ServerNetwork
 *
 */
export class ClientNetwork extends System {
  constructor(world) {
    super(world)
    this.ids = -1
    this.ws = null
    this.apiUrl = null
    this.id = null
  }

  makeId() {
    return `${this.id}_${++this.ids}`
  }

  init({ wsUrl, apiUrl }) {
    const authToken = this.world.client.storage.get('authToken')
    this.apiUrl = apiUrl
    this.ws = new WebSocket(`${wsUrl}?authToken=${authToken}`)
    this.ws.binaryType = 'arraybuffer'
    this.ws.addEventListener('message', this.onPacket)
    this.ws.addEventListener('close', this.onClose)
  }

  send(name, data) {
    // console.log('->', name, data)
    const packet = writePacket(name, data)
    this.ws.send(packet)
  }

  async upload(file) {
    const form = new FormData()
    form.append('file', file)
    const url = `${this.apiUrl}/upload`
    await fetch(url, {
      method: 'POST',
      body: form,
    })
  }

  onPacket = e => {
    const [method, data] = readPacket(e.data)
    // console.log('<-', method, data)
    this[method]?.(data)
  }

  onSnapshot(data) {
    this.id = data.id
    this.world.chat.deserialize(data.chat)
    this.world.apps.deserialize(data.apps)
    this.world.entities.deserialize(data.entities)
    this.world.client.storage.set('authToken', data.authToken)
  }

  onChatAdded = msg => {
    this.world.chat.add(msg, false)
  }

  onAppAdded = config => {
    this.world.apps.add(config)
  }

  onEntityAdded = data => {
    this.world.entities.add(data)
  }

  onEntityModified = data => {
    const entity = this.world.entities.get(data.id)
    entity.modify(data)
  }

  onEntityRemoved = id => {
    this.world.entities.remove(id)
  }

  onClose = () => {
    console.log('connection ended')
  }
}
