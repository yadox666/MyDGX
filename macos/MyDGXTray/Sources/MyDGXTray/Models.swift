import Foundation

struct OverviewResponse: Decodable {
    let metrics: Metrics
    let host: HostInformation
    let services: [String: Bool]
    let benchmarkSuite: BenchmarkSuiteStatus?
    let webApps: [WebApp]?
    let dashboardPasswordClaimed: Bool?

    enum CodingKeys: String, CodingKey {
        case metrics, host, services
        case benchmarkSuite = "benchmark_suite"
        case webApps = "web_apps"
        case dashboardPasswordClaimed = "dashboard_password_claimed"
    }
}

struct WebApp: Decodable, Identifiable {
    let name: String
    let alias: String
    let port: Int
    let state: String
    let reachable: Bool?

    var id: String { name }

    var isValidPort: Bool { (1024...65535).contains(port) }

    /// The app listens on 127.0.0.1 of the DGX; the tray forwards the same port number on the Mac.
    var localURL: URL? {
        isValidPort ? URL(string: "http://127.0.0.1:\(port)/") : nil
    }

    var forwardSpecification: String {
        "127.0.0.1:\(port):127.0.0.1:\(port)"
    }
}

struct BenchmarkSuiteStatus: Decodable {
    let id: String
    let status: String
    let totalModels: Int
    let completedModels: Int
    let currentTarget: String
    let progress: Double
    let message: String

    enum CodingKeys: String, CodingKey {
        case id, status, progress, message
        case totalModels = "total_models"
        case completedModels = "completed_models"
        case currentTarget = "current_target"
    }

    var isActive: Bool {
        ["queued", "running", "restoring"].contains(status)
    }
}

struct Metrics: Decodable {
    let memoryPercent: Double
    let memoryUsed: Int64
    let memoryTotal: Int64
    let memoryAvailable: Int64?
    let gpuUtilization: Double?
    let gpuMemoryUsed: Int64?
    let gpuMemoryTotal: Int64?
    let gpuTemperature: Double?

    enum CodingKeys: String, CodingKey {
        case memoryPercent = "memory_percent"
        case memoryUsed = "memory_used"
        case memoryTotal = "memory_total"
        case memoryAvailable = "memory_available"
        case gpuUtilization = "gpu_utilization"
        case gpuMemoryUsed = "gpu_memory_used"
        case gpuMemoryTotal = "gpu_memory_total"
        case gpuTemperature = "gpu_temperature"
    }

    var gpuMemoryPercent: Double? {
        guard let used = gpuMemoryUsed, let total = gpuMemoryTotal, total > 0 else { return nil }
        return Double(used) / Double(total) * 100
    }

    var freeMemory: Int64 {
        memoryAvailable ?? max(0, memoryTotal - memoryUsed)
    }
}

struct HostInformation: Decodable {
    let hostname: String
    let deviceModel: String?
    let deviceVariant: String?

    enum CodingKeys: String, CodingKey {
        case hostname
        case deviceModel = "device_model"
        case deviceVariant = "device_variant"
    }
}

struct ProfilesResponse: Decodable {
    let profiles: [InferenceProfile]
    let runtime: ProfileRuntime
}

struct InferenceProfile: Decodable, Identifiable {
    let id: String
    let name: String
    let engine: String
    let modelRef: String
    let active: Int
    let memoryPlan: ProfileMemoryPlan?
    let runtimePlan: ProfileRuntimePlan?
    let readOnly: Bool?
    let modelLabels: [String]?
    let models: [ProfileModelSummary]?

    var isReadOnly: Bool { readOnly ?? managedProfileIDs.contains(id) }

    enum CodingKeys: String, CodingKey {
        case id, name, engine, active
        case modelRef = "model_ref"
        case memoryPlan = "memory_plan"
        case runtimePlan = "runtime_plan"
        case readOnly = "read_only"
        case modelLabels = "model_labels"
        case models
    }
}

struct ProfileModelSummary: Decodable, Identifiable {
    let id: String
    let name: String
    let engine: String
    let modelRef: String

    enum CodingKeys: String, CodingKey {
        case id, name, engine
        case modelRef = "model_ref"
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        name = (try? values.decodeIfPresent(String.self, forKey: .name)) ?? ""
        engine = (try? values.decodeIfPresent(String.self, forKey: .engine)) ?? ""
        modelRef = (try? values.decodeIfPresent(String.self, forKey: .modelRef)) ?? ""
        id = (try? values.decodeIfPresent(String.self, forKey: .id)) ?? (modelRef.isEmpty ? name : modelRef)
    }

    var quickSource: String { engine == "ollama" ? "ollama" : "huggingface" }

    /// Same short form as the dashboard: repository name without owner or GGUF suffix.
    var label: String {
        let last = modelRef.split(separator: "/").last.map(String.init) ?? modelRef
        let trimmed = last.replacingOccurrences(
            of: #"[-_.]gguf$"#, with: "", options: [.regularExpression, .caseInsensitive]
        )
        return trimmed.isEmpty ? name : trimmed
    }
}

/// Default and Quick are managed from the Models view and do not count towards the two-profile limit.
let managedProfileIDs: Set<String> = ["mydgx-default", "mydgx-quick"]

func userProfileCount(_ profileIDs: [String]) -> Int {
    profileIDs.filter { !managedProfileIDs.contains($0) }.count
}

struct ProfileMemoryPlan: Decodable {
    let requiredMB: Int

    enum CodingKeys: String, CodingKey {
        case requiredMB = "required_mb"
    }
}

struct ProfileRuntime: Decodable {
    let running: Bool
    let profileID: String?
    let profileIDs: [String]
    let runningModels: Int

    enum CodingKeys: String, CodingKey {
        case running
        case profileID = "profile_id"
        case profileIDs = "profile_ids"
        case runningModels = "running_models"
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        running = try values.decode(Bool.self, forKey: .running)
        profileID = try values.decodeIfPresent(String.self, forKey: .profileID)
        profileIDs = try values.decodeIfPresent([String].self, forKey: .profileIDs)
            ?? profileID.map { [$0] }
            ?? []
        runningModels = try values.decodeIfPresent(Int.self, forKey: .runningModels)
            ?? (running ? 1 : 0)
    }
}

struct ProfileRuntimePlan: Decodable {
    let profileIDs: [String]
    let uniqueModels: Int
    let sharedModels: Int
    let requiredMB: Int
    let incrementalMB: Int
    let reserveMB: Int
    let capacityMB: Int
    let availableMB: Int
    let aliasConflicts: [String]
    let portConflicts: [Int]
    let llmSlots: Int?
    let maxLLMSlots: Int?
    let fits: Bool

    /// Older backends do not report slots and only counted user profiles.
    var exceedsLLMLimit: Bool {
        if let llmSlots, let maxLLMSlots {
            return llmSlots > maxLLMSlots
        }
        return userProfileCount(profileIDs) > 2
    }

    enum CodingKeys: String, CodingKey {
        case profileIDs = "profile_ids"
        case uniqueModels = "unique_models"
        case sharedModels = "shared_models"
        case requiredMB = "required_mb"
        case incrementalMB = "incremental_mb"
        case reserveMB = "reserve_mb"
        case capacityMB = "capacity_mb"
        case availableMB = "available_mb"
        case aliasConflicts = "alias_conflicts"
        case portConflicts = "port_conflicts"
        case llmSlots = "llm_slots"
        case maxLLMSlots = "max_llm_slots"
        case fits
    }
}

struct JobStartResponse: Decodable {
    let jobID: String

    enum CodingKeys: String, CodingKey {
        case jobID = "job_id"
    }
}

struct JobStatus: Decodable {
    let id: String
    let kind: String
    let target: String
    let status: String
    let progress: Double
    let message: String
}

struct DeploymentStatus {
    let progress: Double
    let phase: String
    let detail: String
    let error: String?
    let completed: Bool
}
