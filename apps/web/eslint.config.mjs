import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'

export default [
  {
    ignores: ['.next*/**', 'node_modules/**', '参考项目/**'],
  },
  ...nextCoreWebVitals,
]
