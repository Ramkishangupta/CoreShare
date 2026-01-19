import { useEffect, useState, useRef } from 'react'
import { X, Clock, CheckCircle, XCircle, Loader, Cpu, HardDrive, Server, Copy, RotateCcw } from 'lucide-react'
import { io, Socket } from 'socket.io-client'
import api from '@/lib/api'

interface JobDetailsModalProps {
    jobId: number
    onClose: () => void
}

interface JobDetails {
    id: number
    status: string
    dockerfile: string
    resources: {
        gpu: number
        cpu: number
        ram: number
    }
    logs: string
    result: any
    error_message: string
    created_at: string
    start_time: string
    end_time: string
}

export default function JobDetailsModal({ jobId, onClose }: JobDetailsModalProps) {
    const [job, setJob] = useState<JobDetails | null>(null)
    const [logs, setLogs] = useState('')
    const [loading, setLoading] = useState(true)
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
    const logsEndRef = useRef<HTMLDivElement>(null)
    const socketRef = useRef<Socket | null>(null)

    // Auto-scroll logs to bottom
    const scrollToBottom = () => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }

    useEffect(() => {
        scrollToBottom()
    }, [logs])

    // Load job details
    useEffect(() => {
        const loadJob = async () => {
            try {
                const response = await api.get(`/jobs/${jobId}`)
                let jobData = response.data.job || response.data

                // Normalize data - handle both camelCase and snake_case from backend
                const normalized = {
                    ...jobData,
                    created_at: jobData.created_at || jobData.createdAt,
                    start_time: jobData.start_time || jobData.startTime,
                    end_time: jobData.end_time || jobData.endTime,
                    resources: jobData.resources || jobData.resources_requested || { cpu: 0, ram: 0, gpu: 0 }
                }

                setJob(normalized)
                setLogs(normalized.logs || '')
                setLoading(false)
            } catch (error) {
                console.error('Failed to load job:', error)
                setLoading(false)
            }
        }

        loadJob()
    }, [jobId])

    // Polling fallback for job status updates
    useEffect(() => {
        // Only poll for running or queued jobs
        if (!job || (job.status !== 'running' && job.status !== 'queued')) {
            return
        }

        const pollInterval = setInterval(async () => {
            try {
                const response = await api.get(`/jobs/${jobId}`)
                let jobData = response.data.job || response.data

                const normalized = {
                    ...jobData,
                    created_at: jobData.created_at || jobData.createdAt,
                    start_time: jobData.start_time || jobData.startTime,
                    end_time: jobData.end_time || jobData.endTime,
                    resources: jobData.resources || jobData.resources_requested || { cpu: 0, ram: 0, gpu: 0 }
                }

                setJob(normalized)
                setLogs(normalized.logs || '')
            } catch (error) {
                console.error('Failed to poll job status:', error)
            }
        }, 3000) // Poll every 3 seconds

        return () => clearInterval(pollInterval)
    }, [jobId, job?.status])

    // Socket.io for real-time logs
    useEffect(() => {
        const orchestratorUrl = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:3000'
        socketRef.current = io(orchestratorUrl)

        // Listen for job status updates
        socketRef.current.on(`job:${jobId}:status`, (data: any) => {
            if (data.logs) {
                setLogs(prev => prev + data.logs)
            }
            if (data.status && job) {
                setJob({ ...job, status: data.status })
            }
        })

        // Listen for job completion
        socketRef.current.on(`job:${jobId}:complete`, (data: any) => {
            if (job) {
                setJob({
                    ...job,
                    status: data.success ? 'completed' : 'failed',
                    end_time: new Date().toISOString(),
                    result: data.result,
                    error_message: data.error
                })
            }
        })

        return () => {
            socketRef.current?.disconnect()
        }
    }, [jobId, job])

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'completed':
                return <CheckCircle className="w-6 h-6 text-green-500" />
            case 'failed':
            case 'cancelled':
                return <XCircle className="w-6 h-6 text-red-500" />
            case 'running':
                return <Loader className="w-6 h-6 text-blue-500 animate-spin" />
            default:
                return <Clock className="w-6 h-6 text-yellow-500" />
        }
    }

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed':
                return 'bg-green-100 text-green-800'
            case 'failed':
            case 'cancelled':
                return 'bg-red-100 text-red-800'
            case 'running':
                return 'bg-blue-100 text-blue-800'
            default:
                return 'bg-yellow-100 text-yellow-800'
        }
    }

    const calculateDuration = () => {
        if (!job?.start_time) return 'N/A'
        const start = new Date(job.start_time)
        const end = job.end_time ? new Date(job.end_time) : new Date()
        const seconds = Math.floor((end.getTime() - start.getTime()) / 1000)
        return `${seconds}s`
    }

    const calculateCost = () => {
        if (!job?.start_time) return '$0.00'
        const start = new Date(job.start_time)
        const end = job.end_time ? new Date(job.end_time) : new Date()
        const minutes = Math.ceil((end.getTime() - start.getTime()) / 60000)

        const gpuCost = (job.resources?.gpu || 0) * minutes * 0.1
        const cpuCost = (job.resources?.cpu || 0) * minutes * 0.02
        const total = gpuCost + cpuCost

        return `$${total.toFixed(2)}`
    }

    // Action handlers
    const handleCopyLogs = () => {
        navigator.clipboard.writeText(logs)
        setToast({ message: 'Logs copied to clipboard!', type: 'success' })
        setTimeout(() => setToast(null), 3000)
    }

    const handleCancelJob = async () => {
        try {
            await api.post(`/jobs/${jobId}/cancel`)
            setToast({ message: 'Job cancelled successfully', type: 'success' })
            setTimeout(() => setToast(null), 3000)
            // Reload job data
            const response = await api.get(`/jobs/${jobId}`)
            const jobData = response.data.job || response.data
            const normalized = {
                ...jobData,
                created_at: jobData.created_at || jobData.createdAt,
                start_time: jobData.start_time || jobData.startTime,
                end_time: jobData.end_time || jobData.endTime,
                resources: jobData.resources || jobData.resources_requested || { cpu: 0, ram: 0, gpu: 0 }
            }
            setJob(normalized)
        } catch (error) {
            setToast({ message: 'Failed to cancel job', type: 'error' })
            setTimeout(() => setToast(null), 3000)
        }
    }

    const handleResubmit = async () => {
        try {
            const response = await api.post(`/jobs/${jobId}/resubmit`)
            setToast({ message: `New job #${response.data.job.id} submitted!`, type: 'success' })
            setTimeout(() => {
                setToast(null)
                onClose() // Close modal after resubmit
            }, 2000)
        } catch (error) {
            setToast({ message: 'Failed to resubmit job', type: 'error' })
            setTimeout(() => setToast(null), 3000)
        }
    }

    if (loading) {
        return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg p-8">
                    <Loader className="w-8 h-8 animate-spin text-blue-500" />
                </div>
            </div>
        )
    }

    if (!job) {
        return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg p-8">
                    <p>Job not found</p>
                    <button onClick={onClose} className="mt-4 text-blue-600">Close</button>
                </div>
            </div>
        )
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b">
                    <div className="flex items-center space-x-4">
                        <h2 className="text-2xl font-bold text-gray-900">Job #{job.id}</h2>
                        <div className="flex items-center space-x-2">
                            {getStatusIcon(job.status)}
                            <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(job.status)}`}>
                                {job.status}
                            </span>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Timeline */}
                    <div className="bg-gray-50 rounded-lg p-6">
                        <h3 className="text-lg font-semibold mb-4">Timeline</h3>
                        <div className="flex items-center justify-between relative">
                            <div className="absolute top-5 left-0 right-0 h-0.5 bg-gray-300"></div>

                            <div className="relative z-10 flex flex-col items-center">
                                <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center mb-2">
                                    <div className="w-4 h-4 rounded-full bg-white"></div>
                                </div>
                                <p className="text-sm font-medium">Submitted</p>
                                <p className="text-xs text-gray-500">{new Date(job.created_at).toLocaleTimeString()}</p>
                            </div>

                            <div className="relative z-10 flex flex-col items-center">
                                <div className={`w-10 h-10 rounded-full ${job.start_time ? 'bg-blue-500' : 'bg-gray-300'} flex items-center justify-center mb-2`}>
                                    <div className="w-4 h-4 rounded-full bg-white"></div>
                                </div>
                                <p className="text-sm font-medium">Started</p>
                                <p className="text-xs text-gray-500">
                                    {job.start_time ? new Date(job.start_time).toLocaleTimeString() : 'Waiting...'}
                                </p>
                            </div>

                            <div className="relative z-10 flex flex-col items-center">
                                <div className={`w-10 h-10 rounded-full ${job.end_time ? 'bg-green-500' : 'bg-gray-300'} flex items-center justify-center mb-2`}>
                                    <div className="w-4 h-4 rounded-full bg-white"></div>
                                </div>
                                <p className="text-sm font-medium">
                                    {job.status === 'failed' ? 'Failed' : job.status === 'cancelled' ? 'Cancelled' : 'Completed'}
                                </p>
                                <p className="text-xs text-gray-500">
                                    {job.end_time ? new Date(job.end_time).toLocaleTimeString() : 'Running...'}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Resources */}
                    <div className="bg-gray-50 rounded-lg p-6">
                        <h3 className="text-lg font-semibold mb-4">Resources</h3>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="flex items-center space-x-3 bg-white p-4 rounded-lg">
                                <Cpu className="w-8 h-8 text-blue-500" />
                                <div>
                                    <p className="text-sm text-gray-500">CPU</p>
                                    <p className="font-semibold">{job.resources?.cpu || 0} Cores</p>
                                </div>
                            </div>
                            <div className="flex items-center space-x-3 bg-white p-4 rounded-lg">
                                <HardDrive className="w-8 h-8 text-purple-500" />
                                <div>
                                    <p className="text-sm text-gray-500">RAM</p>
                                    <p className="font-semibold">{job.resources?.ram || 0}GB</p>
                                </div>
                            </div>
                            <div className="flex items-center space-x-3 bg-white p-4 rounded-lg">
                                <Server className="w-8 h-8 text-green-500" />
                                <div>
                                    <p className="text-sm text-gray-500">Worker</p>
                                    <p className="font-semibold text-xs">worker-{jobId % 10}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Logs */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-lg font-semibold">Logs</h3>
                            <button
                                onClick={handleCopyLogs}
                                className="flex items-center space-x-2 px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors"
                            >
                                <Copy className="w-4 h-4" />
                                <span>Copy Logs</span>
                            </button>
                        </div>
                        <div className="bg-gray-900 rounded-lg p-4 h-64 overflow-y-auto font-mono text-sm">
                            <pre className="text-green-400 whitespace-pre-wrap">
                                {logs || 'No logs yet...'}
                            </pre>
                            <div ref={logsEndRef} />
                        </div>
                    </div>

                    {/* Cost */}
                    <div className="bg-blue-50 rounded-lg p-6">
                        <h3 className="text-lg font-semibold mb-4 text-gray-900">Cost</h3>
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <p className="text-sm text-gray-600">Duration</p>
                                <p className="text-xl font-bold text-gray-900">{calculateDuration()}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-600">Rate</p>
                                <p className="text-xl font-bold text-gray-900">$0.02/min</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-600">Total Cost</p>
                                <p className="text-xl font-bold text-blue-600">{calculateCost()}</p>
                            </div>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-between pt-4 border-t">
                        <button
                            onClick={handleResubmit}
                            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                        >
                            <RotateCcw className="w-4 h-4" />
                            <span>Resubmit Job</span>
                        </button>
                        {(job.status === 'running' || job.status === 'queued') && (
                            <button
                                onClick={handleCancelJob}
                                className="flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                            >
                                <X className="w-4 h-4" />
                                <span>Cancel Job</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* Toast Notification */}
                {toast && (
                    <div className={`absolute top-4 right-4 px-4 py-3 rounded-lg shadow-lg ${toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
                        } text-white animate-fade-in`}>
                        {toast.message}
                    </div>
                )}
            </div>
        </div>
    )
}
