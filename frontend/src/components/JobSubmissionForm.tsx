import { useState } from 'react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { Upload } from 'lucide-react'

export default function JobSubmissionForm() {
  const [dockerfile, setDockerfile] = useState('')
  const [resources, setResources] = useState({
    gpu: 0,
    cpu: 2,
    ram: 4
  })
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!dockerfile.trim()) {
      toast.error('Please provide a Dockerfile')
      return
    }

    setSubmitting(true)

    try {
      await api.post('/jobs', {
        dockerfile,
        resources
      })

      toast.success('Job submitted successfully!')
      setDockerfile('')
      setResources({ gpu: 0, cpu: 2, ram: 4 })
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to submit job')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Submit New Job</h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Dockerfile */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Dockerfile
          </label>
          <textarea
            value={dockerfile}
            onChange={(e) => setDockerfile(e.target.value)}
            rows={12}
            className="input w-full font-mono text-sm text-black placeholder-gray-500 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="FROM ubuntu:latest&#10;RUN apt-get update&#10;# Your Dockerfile content..."
            required
          />
          <p className="text-sm text-gray-500 mt-1">
            Paste your Dockerfile content here
          </p>
        </div>

        {/* Resources */}
        <div className="grid md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              GPU Count
            </label>
            <input
              type="number"
              min="0"
              max="4"
              value={resources.gpu}
              onChange={(e) => setResources({ ...resources, gpu: parseInt(e.target.value) })}
              className="input w-full text-black placeholder-gray-500 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              CPU Cores
            </label>
            <input
              type="number"
              min="1"
              max="32"
              value={resources.cpu}
              onChange={(e) => setResources({ ...resources, cpu: parseInt(e.target.value) })}
              className="input w-full text-black placeholder-gray-500 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              RAM (GB)
            </label>
            <input
              type="number"
              min="1"
              max="128"
              value={resources.ram}
              onChange={(e) => setResources({ ...resources, ram: parseInt(e.target.value) })}
              className="input w-full text-black placeholder-gray-500 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>

        {/* Estimated Cost */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-2">Estimated Cost</h3>
          <p className="text-sm text-blue-800">
            ~${((resources.gpu * 0.10 + resources.cpu * 0.02) * 60).toFixed(2)} per hour
          </p>
          <p className="text-xs text-blue-600 mt-1">
            GPU: $0.10/min • CPU: $0.02/min
          </p>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="btn-primary w-full flex items-center justify-center space-x-2"
        >
          <Upload className="w-5 h-5" />
          <span>{submitting ? 'Submitting...' : 'Submit Job'}</span>
        </button>
      </form>
    </div>
  )
}
