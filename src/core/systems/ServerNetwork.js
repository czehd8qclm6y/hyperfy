import moment from 'moment'
import { writePacket } from '../packets'
import { Socket } from '../Socket'
import { addRole, hasRole, serializeRoles, uuid } from '../utils'
import { System } from './System'
import { createJWT, readJWT } from '../utils-server'

const SAVE_RATE = 60 // seconds
const PING_RATE = 1 // seconds

/**
 * Server Network System
 *
 * - runs on the server
 * - provides abstract network methods matching ClientNetwork
 *
 */
export class ServerNetwork extends System {
  constructor(world) {
    super(world)
    this.id = 0
    this.ids = -1
    this.sockets = new Map()
    this.socketIntervalId = setInterval(() => this.checkSockets(), PING_RATE * 1000)
    this.saveTimerId = null
    this.dirtyBlueprints = new Set()
    this.dirtyApps = new Set()
  }

  init({ db }) {
    this.db = db
  }

  async start() {
    // hydrate blueprints
    const blueprints = await this.db('blueprints')
    for (const blueprint of blueprints) {
      const data = JSON.parse(blueprint.data)
      this.world.blueprints.add(data, true)
    }
    // hydrate entities
    const entities = await this.db('entities')
    for (const entity of entities) {
      const data = JSON.parse(entity.data)
      this.world.entities.add(data, true)
    }
    // queue first save
    this.saveTimerId = setTimeout(this.save, SAVE_RATE * 1000)
  }

  send(name, data, ignoreSocket) {
    // console.log('->>>', name, data)
    const packet = writePacket(name, data)
    this.sockets.forEach(socket => {
      if (socket === ignoreSocket) return
      socket.sendPacket(packet)
    })
  }

  checkSockets() {
    // see: https://www.npmjs.com/package/ws#how-to-detect-and-close-broken-connections
    const dead = []
    this.sockets.forEach(socket => {
      if (!socket.alive) {
        dead.push(socket)
      } else {
        socket.ping()
      }
    })
    dead.forEach(socket => socket.disconnect())
  }

  save = async () => {
    const counts = {
      upsertedBlueprints: 0,
      upsertedApps: 0,
      deletedApps: 0,
    }
    const now = moment().toISOString()
    // blueprints
    for (const id of this.dirtyBlueprints) {
      const blueprint = this.world.blueprints.get(id)
      try {
        const record = {
          id: blueprint.id,
          data: JSON.stringify(blueprint),
        }
        await this.db('blueprints')
          .insert({ ...record, createdAt: now, updatedAt: now })
          .onConflict('id')
          .merge({ ...record, updatedAt: now })
        counts.upsertedBlueprints++
        this.dirtyBlueprints.delete(id)
      } catch (err) {
        console.log(`error saving blueprint: ${blueprint.id}`)
        console.error(err)
      }
    }
    // app entities
    for (const id of this.dirtyApps) {
      const entity = this.world.entities.get(id)
      if (entity) {
        // it needs creating/updating
        if (entity.data.uploader || entity.data.mover) {
          continue // ignore while uploading or moving
        }
        try {
          const record = {
            id: entity.data.id,
            data: JSON.stringify(entity.data),
          }
          await this.db('entities')
            .insert({ ...record, createdAt: now, updatedAt: now })
            .onConflict('id')
            .merge({ ...record, updatedAt: now })
          counts.upsertedApps++
          this.dirtyApps.delete(id)
        } catch (err) {
          console.log(`error saving entity: ${entity.data.id}`)
          console.error(err)
        }
      } else {
        // it was removed
        await this.db('entities').where('id', id).delete()
        counts.deletedApps++
        this.dirtyApps.delete(id)
      }
    }
    // log
    console.log(
      `save complete [blueprints:${counts.upsertedBlueprints} apps:${counts.upsertedApps} apps-removed:${counts.deletedApps}]`
    )
    // queue again
    this.saveTimerId = setTimeout(this.save, SAVE_RATE * 1000)
  }

  async onConnection(ws, authToken) {
    try {
      // get or create user
      let user
      if (authToken) {
        try {
          const { userId } = await readJWT(authToken)
          user = await this.db('users').where('id', userId).first()
        } catch (err) {
          console.error('failed to read authToken:', authToken)
        }
      }
      if (!user) {
        user = {
          id: uuid(),
          name: 'Anonymous',
          roles: '',
          createdAt: moment().toISOString(),
        }
        await this.db('users').insert(user)
        authToken = await createJWT({ userId: user.id })
      }
      user.roles = user.roles.split(',')

      // if there is no admin code, everyone is a temporary admin (eg for local dev)
      // all roles prefixed with `~` are temporary and not persisted to db
      if (!process.env.ADMIN_CODE) {
        user.roles.push('~admin')
      }

      // create socket
      const socket = new Socket({ ws, network: this })

      // spawn player
      socket.player = this.world.entities.add(
        {
          id: uuid(),
          type: 'player',
          position: [0, 0, 0],
          quaternion: [0, 0, 0, 1],
          owner: socket.id,
          user,
        },
        true
      )

      // send snapshot
      socket.send('snapshot', {
        id: socket.id,
        chat: this.world.chat.serialize(),
        blueprints: this.world.blueprints.serialize(),
        entities: this.world.entities.serialize(),
        authToken,
      })

      this.sockets.set(socket.id, socket)
    } catch (err) {
      console.error(err)
    }
  }

  onChatAdded = async (socket, msg) => {
    // TODO: check for spoofed messages, permissions/roles etc
    // handle slash commands
    if (msg.body.startsWith('/')) {
      const [cmd, arg1, arg2] = msg.body.slice(1).split(' ')
      // become admin command
      if (cmd === 'admin') {
        const code = arg1
        if (code !== process.env.ADMIN_CODE || !process.env.ADMIN_CODE) return
        const player = socket.player
        const id = player.data.id
        const user = player.data.user
        if (hasRole(user.roles, 'admin')) {
          return socket.send('chatAdded', {
            id: uuid(),
            from: null,
            fromId: null,
            body: 'You are already an admin',
            createdAt: moment().toISOString(),
          })
        }
        addRole(user.roles, 'admin')
        player.modify({ user })
        this.send('entityModified', { id, user })
        socket.send('chatAdded', {
          id: uuid(),
          from: null,
          fromId: null,
          body: 'Admin granted!',
          createdAt: moment().toISOString(),
        })
        await this.db('users')
          .where('id', user.id)
          .update({ roles: serializeRoles(user.roles) })
      }
      if (cmd === 'name') {
        const name = arg1
        const player = socket.player
        const id = player.data.id
        const user = player.data.user
        player.data.user.name = name
        player.modify({ user })
        this.send('entityModified', { id, user })
        socket.send('chatAdded', {
          id: uuid(),
          from: null,
          fromId: null,
          body: `Name set to ${name}!`,
          createdAt: moment().toISOString(),
        })
        await this.db('users').where('id', user.id).update({ name })
      }
      return
    }
    // handle chat messages
    this.world.chat.add(msg, false)
    this.send('chatAdded', msg, socket)
  }

  onBlueprintAdded = (socket, blueprint) => {
    this.world.blueprints.add(blueprint)
    this.send('blueprintAdded', blueprint, socket)
    this.dirtyBlueprints.add(blueprint.id)
  }

  onEntityAdded = (socket, data) => {
    // TODO: check client permission
    const entity = this.world.entities.add(data)
    this.send('entityAdded', data, socket)
    if (entity.isApp) this.dirtyApps.add(entity.data.id)
  }

  onEntityModified = (socket, data) => {
    // TODO: check client permission
    const entity = this.world.entities.get(data.id)
    entity.modify(data)
    this.send('entityModified', data, socket)
    if (entity.isApp) this.dirtyApps.add(entity.data.id)
  }

  onEntityRemoved = (socket, id) => {
    // TODO: check client permission
    const entity = this.world.entities.get(id)
    this.world.entities.remove(id)
    this.send('entityRemoved', id, socket)
    if (entity.isApp) this.dirtyApps.add(id)
  }

  onDisconnect = (socket, code) => {
    socket.player.destroy(true)
    this.sockets.delete(socket.id)
  }
}
