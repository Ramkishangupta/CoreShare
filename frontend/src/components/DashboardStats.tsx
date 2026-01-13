import { useEffect, useState } from 'react'
import { FileText, TrendingUp, DollarSign, Calendar, Loader2, CheckCircle, XCircle } from 'lucide-react'
import api from '@/lib/api'

interface Stats {
    totalJobs: number
    completedJobs: number
    failedJobs: number
    runningJobs: number
    queuedJobs: number
    successRate: number
    totalSpent: string
    thisMonthSpent: string
}

export default function DashboardStats() {
    const [stats, setStats] = useState<Stats | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadStats()
        // Auto-refresh every 30 seconds
        const interval = setInterval(loadStats, 30000)
        return () => clearInterval(interval)
    }, [])

    const loadStats = async () => {
        try {
            const response = await api.get('/stats')
            setStats(response.data)
            setLoading(false)
        } catch (error) {
            console.error('Failed to load stats:', error)
            setLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="bg-white rounded-lg shadow p-6 animate-pulse">
                        <div className="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
                        <div className="h-8 bg-gray-200 rounded w-3/4"></div>
                    </div>
                ))}
            </div>
        )
    }

    if (!stats) return null

    const statCards = [
        {
            title: 'Total Jobs',
            value: stats.totalJobs,
            icon: FileText,
            color: 'blue',
            bgColor: 'bg-blue-50',
            iconColor: 'text-blue-600'
        },
        {
            title: 'Success Rate',
            value: `${stats.successRate}%`,
            icon: TrendingUp,
            color: 'green',
            bgColor: 'bg-green-50',
            iconColor: 'text-green-600'
        },
        {
            title: 'Total Spent',
            value: `$${stats.totalSpent}`,
            icon: DollarSign,
            color: 'purple',
            bgColor: 'bg-purple-50',
            iconColor: 'text-purple-600'
        },
        {
            title: 'This Month',
            value: `$${stats.thisMonthSpent}`,
            icon: Calendar,
            color: 'orange',
            bgColor: 'bg-orange-50',
            iconColor: 'text-orange-600'
        }
    ]

    return (
        <div className="mb-6">
            {/* Main Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                {statCards.map((card, index) => {
                    const Icon = card.icon
                    return (
                        <div key={index} className={`${card.bgColor} rounded-lg shadow-sm p-6 transition-transform hover:scale-105`}>
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-gray-600 mb-1">{card.title}</p>
                                    <p className={`text-3xl font-bold ${card.iconColor}`}>{card.value}</p>
                                </div>
                                <div className={`${card.bgColor} p-3 rounded-full`}>
                                    <Icon className={`w-8 h-8 ${card.iconColor}`} />
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Additional Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-lg shadow-sm p-4 flex items-center space-x-4">
                    <div className="bg-green-100 p-3 rounded-full">
                        <CheckCircle className="w-6 h-6 text-green-600" />
                    </div>
                    <div>
                        <p className="text-sm text-gray-600">Completed</p>
                        <p className="text-2xl font-bold text-gray-900">{stats.completedJobs}</p>
                    </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm p-4 flex items-center space-x-4">
                    <div className="bg-red-100 p-3 rounded-full">
                        <XCircle className="w-6 h-6 text-red-600" />
                    </div>
                    <div>
                        <p className="text-sm text-gray-600">Failed</p>
                        <p className="text-2xl font-bold text-gray-900">{stats.failedJobs}</p>
                    </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm p-4 flex items-center space-x-4">
                    <div className="bg-blue-100 p-3 rounded-full">
                        <Loader2 className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                        <p className="text-sm text-gray-600">Running</p>
                        <p className="text-2xl font-bold text-gray-900">{stats.runningJobs}</p>
                    </div>
                </div>
            </div>
        </div>
    )
}
