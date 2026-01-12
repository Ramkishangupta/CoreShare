import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import api from '@/lib/api'
import { Activity, Clock, CheckCircle, DollarSign } from 'lucide-react'

export default function StatsCards() {
  const { user } = useAuth()
  const [stats, setStats] = useState({
    totalJobs: 0,
    runningJobs: 0,
    completedJobs: 0,
    totalSpent: 0
  })

  useEffect(() => {
    loadStats()
  }, [])

  const loadStats = async () => {
    try {
      const [jobsRes, billingRes] = await Promise.all([
        api.get('/jobs'),
        api.get('/users/billing')
      ])

      const jobs = jobsRes.data.jobs
      const billing = billingRes.data.billing

      setStats({
        totalJobs: jobs.length,
        runningJobs: jobs.filter((j: any) => j.status === 'running').length,
        completedJobs: jobs.filter((j: any) => j.status === 'completed').length,
        totalSpent: billing.reduce((sum: number, b: any) => sum + b.cost, 0)
      })
    } catch (error) {
      console.error('Failed to load stats:', error)
    }
  }

  return (
    <div className="grid md:grid-cols-4 gap-6">
      <StatCard
        icon={<Activity className="w-6 h-6" />}
        title="Total Jobs"
        value={stats.totalJobs}
        color="blue"
      />
      <StatCard
        icon={<Clock className="w-6 h-6" />}
        title="Running"
        value={stats.runningJobs}
        color="yellow"
      />
      <StatCard
        icon={<CheckCircle className="w-6 h-6" />}
        title="Completed"
        value={stats.completedJobs}
        color="green"
      />
      <StatCard
        icon={<DollarSign className="w-6 h-6" />}
        title="Total Spent"
        value={`$${stats.totalSpent.toFixed(2)}`}
        color="purple"
      />
    </div>
  )
}

function StatCard({ icon, title, value, color }: any) {
  const colors: any = {
    blue: 'bg-blue-50 text-blue-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600'
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">{title}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        <div className={`p-3 rounded-lg ${colors[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}
