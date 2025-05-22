import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    {
      input: './src/client',
      builder: 'mkdist',
      declaration: true,
    },
    {
      input: './src/node',
      builder: 'mkdist',
      declaration: true,
    },
  ],
  clean: false,
})
