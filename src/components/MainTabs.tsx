import { memo } from 'react'
import type { MainTabKey } from '../utils/mainTab'
import TabPanel from './TabPanel'
import Home from '../pages/Home'
import Counter from '../pages/Counter'
import Expenses from '../pages/Expenses'
import History from '../pages/History'

/** Four main tabs mounted once; visibility toggles without remounting children. */
function MainTabs({ activeTab }: { activeTab: MainTabKey }) {
  return (
    <>
      <TabPanel hidden={activeTab !== '/'}>
        <Home active={activeTab === '/'} />
      </TabPanel>
      <TabPanel hidden={activeTab !== '/counter'}>
        <Counter active={activeTab === '/counter'} />
      </TabPanel>
      <TabPanel hidden={activeTab !== '/expenses'}>
        <Expenses active={activeTab === '/expenses'} />
      </TabPanel>
      <TabPanel hidden={activeTab !== '/history'}>
        <History active={activeTab === '/history'} />
      </TabPanel>
    </>
  )
}

export default memo(MainTabs)
