/**
 * Local helper producing the exact definition shape ctx.tools.register accepts.
 * A profile-installed bundle is linked into the profile's node_modules, so a
 * bare @deepseek-ai/dsh-tools specifier resolves through the link's real path
 * and misses the DSH installation. Building the definition locally keeps the
 * bundle dependency-free while preserving the registry contract.
 */
function parametersToJsonSchema(parameters) {
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(parameters ?? {})) {
    const { required: isRequired, ...rest } = spec
    properties[key] = rest
    if (isRequired === true) required.push(key)
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? { required } : {}),
  }
}

function outputToJsonSchema(schema) {
  if (schema === null || typeof schema !== 'object') return schema
  const source = schema
  if (source.type === 'array') return { ...source, items: outputToJsonSchema(source.items) }
  if (source.properties !== undefined && typeof source.properties === 'object') {
    const properties = {}
    const required = Array.isArray(source.required) ? [...source.required] : []
    for (const [key, spec] of Object.entries(source.properties)) {
      if (spec === null || typeof spec !== 'object') {
        properties[key] = spec
        continue
      }
      const { required: isRequired, ...rest } = spec
      properties[key] = outputToJsonSchema(rest)
      if (isRequired === true && !required.includes(key)) required.push(key)
    }
    return { ...source, properties, ...(required.length > 0 ? { required } : {}) }
  }
  return source
}

export function defineTool(options) {
  return {
    name: options.name,
    description: options.description,
    parameters: parametersToJsonSchema(options.parameters),
    output: {
      schema: outputToJsonSchema(options.output.schema),
      render: options.output.render,
    },
    execute: options.execute,
  }
}
