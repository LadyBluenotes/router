import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'

import {createStart} from '#tanstack-start-createStart-entry'

const fetch = createStartHandler({
  createStart,
})(defaultStreamHandler)

export default {
  fetch,
}
