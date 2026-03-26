
import sys
import json
import math
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp

def haversine(lat1, lon1, lat2, lon2):
    R = 6371  # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * \
        math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def create_data_model(input_data):
    data = {}
    locations = input_data['locations']
    num_locations = len(locations)
    
    # Distance matrix (in meters)
    dist_matrix = [[0] * num_locations for _ in range(num_locations)]
    for i in range(num_locations):
        for j in range(num_locations):
            if i == j: continue
            dist = haversine(locations[i]['lat'], locations[i]['lng'], 
                             locations[j]['lat'], locations[j]['lng'])
            dist_matrix[i][j] = int(dist * 1000) # Meters
            
    data['distance_matrix'] = dist_matrix
    
    # Time matrix (approx 40km/h = 11.1 m/s)
    avg_speed = 11.1 
    time_matrix = [[0] * num_locations for _ in range(num_locations)]
    for i in range(num_locations):
        for j in range(num_locations):
            if i == j: continue
            time_matrix[i][j] = int(dist_matrix[i][j] / avg_speed) + (locations[j].get('serviceTime', 0) * 60)
            
    data['time_matrix'] = time_matrix
    
    # Time Windows (in seconds from midnight)
    def time_to_seconds(t_str):
        if not t_str: return None
        h, m = map(int, t_str.split(':'))
        return h * 3600 + m * 60

    time_windows = []
    for loc in locations:
        start = time_to_seconds(loc.get('timeWindowStart')) or 0
        end = time_to_seconds(loc.get('timeWindowEnd')) or 86400 # 24h
        time_windows.append((start, end))
        
    data['time_windows'] = time_windows
    data['num_vehicles'] = len(input_data['vehicles'])
    data['depot'] = input_data.get('depot', 0)
    data['vehicle_capacities'] = [v.get('capacity', 100) for v in input_data['vehicles']]
    data['demands'] = [loc.get('demand', 0) for loc in locations]
    
    return data

def main():
    try:
        input_data = json.loads(sys.stdin.read())
        data = create_data_model(input_data)
        
        manager = pywrapcp.RoutingIndexManager(len(data['distance_matrix']),
                                               data['num_vehicles'], data['depot'])
        routing = pywrapcp.RoutingModel(manager)

        # Distance Constraint
        def distance_callback(from_index, to_index):
            return data['distance_matrix'][manager.IndexToNode(from_index)][manager.IndexToNode(to_index)]
        
        transit_distance_callback_index = routing.RegisterTransitCallback(distance_callback)
        routing.SetArcCostEvaluatorOfAllVehicles(transit_distance_callback_index)

        # Capacity Constraint
        def demand_callback(from_index):
            return data['demands'][manager.IndexToNode(from_index)]
        
        demand_callback_index = routing.RegisterUnaryTransitCallback(demand_callback)
        routing.AddDimensionWithVehicleCapacity(
            demand_callback_index, 0, data['vehicle_capacities'], True, 'Capacity')

        # Time Window Constraint
        def time_callback(from_index, to_index):
            return data['time_matrix'][manager.IndexToNode(from_index)][manager.IndexToNode(to_index)]
        
        transit_time_callback_index = routing.RegisterTransitCallback(time_callback)
        routing.AddDimension(
            transit_time_callback_index,
            3600, # Allow 1h waiting time
            86400, # Max day time
            False, # Start at 0
            'Time'
        )
        time_dimension = routing.GetDimensionOrDie('Time')
        for i, (start, end) in enumerate(data['time_windows']):
            index = manager.NodeToIndex(i)
            time_dimension.CumulVar(index).SetRange(start, end)

        search_parameters = pywrapcp.DefaultRoutingSearchParameters()
        search_parameters.first_solution_strategy = (
            routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC)
        search_parameters.local_search_metaheuristic = (
            routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH)
        search_parameters.time_limit.seconds = 30

        solution = routing.SolveWithParameters(search_parameters)

        if solution:
            result = []
            for vehicle_id in range(data['num_vehicles']):
                index = routing.Start(vehicle_id)
                route = {'vehicle_index': vehicle_id, 'stops': []}
                while not routing.IsEnd(index):
                    node_index = manager.IndexToNode(index)
                    time_var = time_dimension.CumulVar(index)
                    route['stops'].append({
                        'location_index': node_index,
                        'arrival_time': solution.Min(time_var)
                    })
                    index = solution.Value(routing.NextVar(index))
                
                # Add destination
                node_index = manager.IndexToNode(index)
                time_var = time_dimension.CumulVar(index)
                route['stops'].append({
                    'location_index': node_index,
                    'arrival_time': solution.Min(time_var)
                })
                result.append(route)
            
            print(json.dumps({'status': 'success', 'routes': result}))
        else:
            print(json.dumps({'status': 'error', 'message': 'No solution found'}))

    except Exception as e:
        print(json.dumps({'status': 'error', 'message': str(e)}))

if __name__ == '__main__':
    main()
