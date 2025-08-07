import antfu from '@antfu/eslint-config'

// Define custom rule implementation
const camelCaseRule = {
  create(context) {
    return {
      VariableDeclarator(node) {
        // Check variable declarations specifically
        if (node.id && node.id.type === 'Identifier') {
          const name = node.id.name
          // Check if it's not camelCase (doesn't start with lowercase letter)
          if (!/^[a-z][a-zA-Z0-9]*$/.test(name)) {
            // Allow constants (all uppercase with underscores)
            if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
              context.report({
                node: node.id,
                message: `Variable '${name}' should use camelCase naming convention`,
              })
            }
          }
        }
      },
    }
  },
}

// Create a custom plugin with our rule
const customPlugin = {
  name: 'custom',
  rules: {
    'camel-case-variables': camelCaseRule,
  },
}

export default antfu(
  {
    typescript: true,
    rules: {
      'no-console': 'off',
    },
  },
  // Add our custom plugin to the configuration
  {
    plugins: {
      custom: customPlugin,
    },
    rules: {
      'custom/camel-case-variables': 'off',
      'no-alert': 'off',
    },
  },
)
