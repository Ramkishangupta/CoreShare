import { useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { Cpu, Zap, Shield, Clock } from 'lucide-react'

export default function Home() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <Cpu className="w-8 h-8 text-primary-600" />
            <h1 className="text-2xl font-bold text-gray-900">GPU Cloud</h1>
          </div>
          <div className="space-x-4">
            <Link href="/login" className="text-gray-700 hover:text-primary-600">
              Login
            </Link>
            <Link href="/register" className="btn-primary">
              Get Started
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center">
          <h1 className="text-5xl font-extrabold text-gray-900 sm:text-6xl md:text-7xl">
            Rent <span className="text-primary-600">GPU & CPU</span> Power
          </h1>
          <p className="mt-6 text-xl text-gray-600 max-w-3xl mx-auto">
            Access high-performance computing resources on-demand. 
            Run your Docker containers on our distributed GPU/CPU infrastructure.
          </p>
          <div className="mt-10 flex justify-center gap-4">
            <Link href="/register" className="btn-primary text-lg px-8 py-3">
              Start Computing
            </Link>
            <Link href="/login" className="btn-secondary text-lg px-8 py-3">
              Sign In
            </Link>
          </div>
        </div>

        {/* Features */}
        <div className="mt-24 grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          <FeatureCard
            icon={<Zap className="w-10 h-10 text-primary-600" />}
            title="High Performance"
            description="Latest GPU and CPU hardware for maximum performance"
          />
          <FeatureCard
            icon={<Clock className="w-10 h-10 text-primary-600" />}
            title="Pay Per Use"
            description="Only pay for the resources you actually use"
          />
          <FeatureCard
            icon={<Shield className="w-10 h-10 text-primary-600" />}
            title="Secure & Isolated"
            description="Your containers run in isolated, secure environments"
          />
          <FeatureCard
            icon={<Cpu className="w-10 h-10 text-primary-600" />}
            title="Docker Native"
            description="Just upload your Dockerfile and we handle the rest"
          />
        </div>

        {/* How It Works */}
        <div className="mt-24">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            How It Works
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <StepCard
              number="1"
              title="Upload Dockerfile"
              description="Provide your Dockerfile with your application configuration"
            />
            <StepCard
              number="2"
              title="Select Resources"
              description="Choose GPU/CPU count, memory, and execution time"
            />
            <StepCard
              number="3"
              title="Run & Monitor"
              description="Watch your job execute in real-time and download results"
            />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white mt-24 border-t">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center text-gray-600">
          <p>&copy; 2026 GPU Cloud Platform. Built for efficient computing.</p>
        </div>
      </footer>
    </div>
  )
}

function FeatureCard({ icon, title, description }: any) {
  return (
    <div className="card text-center">
      <div className="flex justify-center mb-4">{icon}</div>
      <h3 className="text-xl font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-600">{description}</p>
    </div>
  )
}

function StepCard({ number, title, description }: any) {
  return (
    <div className="relative">
      <div className="card">
        <div className="absolute -top-4 -left-4 w-12 h-12 bg-primary-600 text-white rounded-full flex items-center justify-center text-xl font-bold">
          {number}
        </div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2 mt-2">{title}</h3>
        <p className="text-gray-600">{description}</p>
      </div>
    </div>
  )
}
