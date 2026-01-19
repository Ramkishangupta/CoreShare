import { Cpu, Zap, HardDrive, DollarSign, CheckCircle, Clock } from 'lucide-react'

interface WorkerCardProps {
  worker: {
    workerId: string
    type: 'GPU' | 'CPU' | 'HYBRID'
    displayMode?: 'GPU' | 'CPU'
    specs: {
      gpuModel?: string | null
      gpuCount: number
      cpuCores: number
      ram: number
      storage: number
    }
    pricing: {
      gpuPerMinute: number
      cpuPerMinute: number
    }
    availability: {
      currentJobs: number
      maxJobs: number
      isAvailable: boolean
    }
  }
  onSelect: (workerId: string) => void
  selected: boolean
}

export default function WorkerSelectionCard({ worker, onSelect, selected }: WorkerCardProps) {
  const isGPU = worker.type === 'GPU'
  const hourlyEstimate = isGPU
    ? worker.pricing.gpuPerMinute * 60 * worker.specs.gpuCount
    : worker.pricing.cpuPerMinute * 60 * worker.specs.cpuCores
  
  return (
    <div
      onClick={() => worker.availability.isAvailable && onSelect(worker.workerId)}
      className={`
        relative border-2 rounded-xl p-6 cursor-pointer transition-all
        ${selected ? 'border-blue-500 bg-blue-50 shadow-lg' : 'border-gray-200 hover:border-blue-300 hover:shadow-md'}
        ${!worker.availability.isAvailable && 'opacity-60 cursor-not-allowed'}
      `}
    >
      {/* Badge */}
      {worker.type === 'HYBRID' && worker.displayMode === 'GPU' && (
        <div className="absolute top-4 right-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-bold px-3 py-1 rounded-full">
          ⚡ HYBRID-GPU
        </div>
      )}
      {worker.type === 'HYBRID' && worker.displayMode === 'CPU' && (
        <div className="absolute top-4 right-4 bg-gradient-to-r from-cyan-500 to-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full">
          💻 HYBRID-CPU
        </div>
      )}
      {worker.type === 'GPU' && !worker.displayMode && worker.specs.gpuModel?.includes('4090') && (
        <div className="absolute top-4 right-4 bg-gradient-to-r from-yellow-400 to-orange-500 text-white text-xs font-bold px-3 py-1 rounded-full">
          🚀 FASTEST
        </div>
      )}
      {worker.type === 'CPU' && !worker.displayMode && (
        <div className="absolute top-4 right-4 bg-gradient-to-r from-green-400 to-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full">
          💰 BUDGET
        </div>
      )}
      
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900">{worker.workerId}</h3>
          <p className="text-sm text-gray-600 mt-1">
            {worker.type === 'HYBRID' && worker.displayMode === 'GPU' 
              ? `${worker.specs.gpuModel} • ${worker.specs.gpuCount}x GPU (Hybrid Mode)`
              : worker.type === 'HYBRID' && worker.displayMode === 'CPU'
              ? `CPU Only (Hybrid Mode - ${worker.specs.cpuCores} cores available)`
              : isGPU 
              ? `${worker.specs.gpuModel} • ${worker.specs.gpuCount}x GPU` 
              : 'CPU Only'
            }
          </p>
        </div>
        
        {worker.availability.isAvailable ? (
          <CheckCircle className="w-6 h-6 text-green-500" />
        ) : (
          <Clock className="w-6 h-6 text-yellow-500" />
        )}
      </div>
      
      {/* Specs */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="flex items-center gap-2 text-sm">
          <Cpu className="w-4 h-4 text-gray-400" />
          <span>{worker.specs.cpuCores} CPU cores</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Zap className="w-4 h-4 text-gray-400" />
          <span>{worker.specs.ram}GB RAM</span>
        </div>
        {worker.specs.storage > 0 && (
          <div className="flex items-center gap-2 text-sm col-span-2">
            <HardDrive className="w-4 h-4 text-gray-400" />
            <span>{worker.specs.storage}GB Storage</span>
          </div>
        )}
      </div>
      
      {/* Pricing */}
      <div className="border-t pt-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <DollarSign className="w-5 h-5 text-green-600" />
          <span className="text-2xl font-bold text-gray-900">
            ${hourlyEstimate.toFixed(2)}<span className="text-sm font-normal text-gray-500">/hour</span>
          </span>
        </div>
        <p className="text-xs text-gray-500">
          {isGPU 
            ? `$${worker.pricing.gpuPerMinute.toFixed(2)}/min per GPU`
            : `$${worker.pricing.cpuPerMinute.toFixed(2)}/min per CPU core`
          }
        </p>
      </div>
      
      {/* Status */}
      <div className={`
        text-sm px-3 py-2 rounded-lg text-center font-medium
        ${worker.availability.isAvailable 
          ? 'bg-green-100 text-green-700' 
          : 'bg-yellow-100 text-yellow-700'
        }
      `}>
        {worker.availability.isAvailable 
          ? '✅ Available Now'
          : `⚠️ Busy (${worker.availability.currentJobs}/${worker.availability.maxJobs} jobs)`
        }
      </div>
      
      {/* Selection indicator */}
      {selected && (
        <div className="absolute -top-2 -right-2 bg-blue-500 text-white rounded-full p-2">
          <CheckCircle className="w-5 h-5" />
        </div>
      )}
    </div>
  )
}
