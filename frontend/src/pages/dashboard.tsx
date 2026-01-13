import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/contexts/AuthContext'
import Sidebar from '@/components/Sidebar'
import JobSubmissionForm from '@/components/JobSubmissionForm'
import JobList from '@/components/JobList'
import DashboardStats from '@/components/DashboardStats'

export default function Dashboard() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [activeTab, setActiveTab] = useState('submit')

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login')
    }
  }, [user, loading, router])

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-gray-600 mt-2">Welcome back, {user.name}!</p>
          </div>

          <DashboardStats />

          <div className="mt-8">
            {activeTab === 'submit' && <JobSubmissionForm />}
            {activeTab === 'jobs' && <JobList />}
          </div>
        </div>
      </main>
    </div>
  )
}
