import { useEffect, useState } from 'react'

import { ContextWheel } from './ContextWheel'
import { InspectPane } from './InspectPane'
import { CodePane } from './CodePane'
import { ChatBox } from './ChatBox'
import { css } from '@firebolt-dev/css'
import { useElemSize } from './useElemSize'
import { MessageCircleMoreIcon } from 'lucide-react'

export function GUI({ world }) {
  const [ref, width, height] = useElemSize()
  return (
    <div
      ref={ref}
      css={css`
        position: absolute;
        inset: 0;
      `}
    >
      {width > 0 && <Content world={world} width={width} height={height} />}
    </div>
  )
}

function Content({ world, width, height }) {
  const mobile = width < 600
  const [context, setContext] = useState(null)
  const [inspect, setInspect] = useState(null)
  const [code, setCode] = useState(false)
  const [chat, setChat] = useState(() => !mobile)
  useEffect(() => {
    setChat(!mobile)
  }, [mobile])
  useEffect(() => {
    world.on('context', setContext)
    world.on('inspect', setInspect)
    world.on('code', setCode)
    return () => {
      world.off('context', setContext)
      world.off('inspect', setInspect)
      world.off('code', setCode)
    }
  }, [])
  return (
    <>
      {mobile && !chat && (
        <ChatBtn
          css={css`
            position: absolute;
            top: 20px;
            left: 20px;
          `}
          world={world}
          onClick={() => setChat(true)}
        />
      )}
      {!mobile && !chat && (
        <ChatBtn
          css={css`
            position: absolute;
            left: 20px;
            bottom: 20px;
          `}
          world={world}
          onClick={() => setChat(true)}
        />
      )}
      {mobile && chat && (
        <ChatBox
          css={css`
            position: absolute;
            top: 20px;
            left: 20px;
            right: 20px;
          `}
          world={world}
          active={true}
          onClose={() => setChat(false)}
        />
      )}
      {!mobile && chat && (
        <ChatBox
          css={css`
            position: absolute;
            bottom: 20px;
            left: 20px;
            width: 100%;
            max-width: 400px;
          `}
          world={world}
          onClose={() => setChat(false)}
        />
      )}
      {context && <ContextWheel key={context.id} {...context} />}
      {inspect && <InspectPane world={world} entity={inspect} />}
      {code && <CodePane world={world} entity={code} />}
    </>
  )
}

function ChatBtn({ ...props }) {
  return (
    <div
      css={css`
        position: absolute;
        bottom: 20px;
        left: 20px;
        width: 50px;
        height: 50px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.2);
        transition: background 0.15s ease-out;
        border-radius: 25px;
        pointer-events: auto;
        &:hover {
          background: rgba(0, 0, 0, 0.8);
          cursor: pointer;
        }
      `}
      {...props}
    >
      <MessageCircleMoreIcon size={20} />
    </div>
  )
}
