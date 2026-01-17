import { useState, useEffect } from 'react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { Upload } from 'lucide-react'
import WorkerSelectionCard from './WorkerSelectionCard'

export default function JobSubmissionForm() {
  const [dockerfile, setDockerfile] = useState('')
  const [workers, setWorkers] = useState<any[]>([])
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchWorkers()
  }, [])

  const fetchWorkers = async () => {
    try {
      const res = await api.get('/workers')
      setWorkers(res.data.workers)
    } catch (error) {
      toast.error('Failed to load workers')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!dockerfile.trim()) {
      toast.error('Please provide a Dockerfile')
      return
    }

    if (!selectedWorker) {
      toast.error('Please select a worker')
      return
    }

    setSubmitting(true)

    try {
      const worker = workers.find(w => w.workerId === selectedWorker)
      
      if (!worker) {
        toast.error('Selected worker not found')
        return
      }
      
      await api.post('/jobs', {
        dockerfile,
        resources: {
          gpu: worker.specs.gpuCount,
          cpu: worker.specs.cpuCores,
          ram: worker.specs.ram,
          gpuModel: worker.specs.gpuModel
        },
        preferredWorkerId: selectedWorker
      })

      toast.success('Job submitted successfully!')
      setDockerfile('')
      setSelectedWorker(null)
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to submit job')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Dockerfile Input */}
      <div className="card">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Submit New Job</h2>
        
        <form onSubmit={handleSubmit} className="space-y-6">
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

          {/* Worker Selection */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Worker</h3>
            
            {loading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                <p className="text-gray-500 mt-4">Loading workers...</p>
              </div>
            ) : workers.length === 0 ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
                <p className="text-yellow-800 font-medium">No workers available</p>
                <p className="text-yellow-600 text-sm mt-2">
                  Please wait for workers to connect or contact an administrator
                </p>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {workers.map(worker => (
                  <WorkerSelectionCard
                    key={worker.workerId}
                    worker={worker}
                    selected={selectedWorker === worker.workerId}
                    onSelect={setSelectedWorker}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting || !selectedWorker}
            className="btn-primary w-full flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload className="w-5 h-5" />
            <span>
              {submitting 
                ? 'Submitting...' 
                : selectedWorker 
                ? `Submit Job to ${selectedWorker}` 
                : 'Select a Worker to Submit'
              }
            </span>
          </button>
        </form>
      </div>
    </div>
  )
}
