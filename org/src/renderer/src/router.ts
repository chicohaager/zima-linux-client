import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    name: 'Debug',
    path: '/',
    component: () => import('./components/Dev/ZeroTier.vue'),
  },
  {
    name: 'Dev',
    path: '/Dev',
    component: () => import('./windows/Dev.vue'),
  },
  {
    name: 'Initialization',
    path: '/Initialization',
    component: () => import('./windows/Initialization'),
  },
  {
    name: 'Device',
    path: '/Device',
    component: () => import('./windows/Device'),
    children: [
      {
        name: 'Default',
        path: '',
        redirect: '/Device/ConnectUsingLanDiscovery',
      },
      {
        name: 'Connect using Lan Discovery',
        path: 'ConnectUsingLanDiscovery',
        component: () => import('./windows/Device/ConnectUsingLanDiscovery.vue'),
      },
      {
        name: 'Connect using Network ID',
        path: 'ConnectUsingNetworkID',
        component: () => import('./windows/Device/ConnectUsingNetworkID.vue'),
      },
      {
        name: 'Connect using IP',
        path: 'ConnectUsingIP',
        component: () => import('./windows/Device/ConnectUsingIP.vue'),
      },
      {
        name: 'Login',
        path: 'Login',
        component: () => import('./windows/Device/Login.vue'),
      },
      {
        name: 'Login Success',
        path: 'LoginSuccess',
        component: () => import('./windows/Device/LoginSuccess.vue'),
      },
    ],
  },
  {
    name: 'Backup',
    path: '/Backup',
    component: () => import('./windows/Backup.vue'),
  },
  {
    name: 'Main',
    path: '/Main',
    component: () => import('./windows/Main.vue'),
  },

]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
